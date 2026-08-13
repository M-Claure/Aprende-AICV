import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { generateResume } from "@/lib/resume/resume-generator";
import { analyzeResume } from "@/lib/resume/resume-analyzer";
import { enrichEntry } from "@/lib/resume/entry-enrichment";
import { answerCharLimitForQuestion, followUpCharLimit } from "@/lib/answer-limits";
import { DEEP_DIVE_SLOTS, MAX_FEEDBACK_QUESTIONS_PER_ITERATION } from "@/lib/config/limits";
import { getCatalogQuestion } from "@/lib/question-engine/question-catalog";
import { AnswerBody } from "@/lib/validation/api-schemas";

let store: MemoryStore;
const ai = new MockAIProvider();

/** A ready profile with a deliberately thin experience and missing sections. */
async function seedThinProfile() {
  const profile = await store.createResumeProfile("u1", {
    careerGoal: "Asistente administrativa",
    targetRole: "Asistente administrativa",
  });
  await store.upsertPersonalInformation(profile.id, { firstName: "María", email: "m@e.com" });
  await store.createExperience(profile.id, {
    experienceType: "family_business",
    organization: "Negocio familiar",
    responsibilities: ["Contestaba llamadas"], // thin: 1 responsibility, no tools/people/metrics
    confirmationStatus: "confirmed",
  });
  await store.createSkill(profile.id, { name: "Atención al cliente", status: "confirmed" });
  return profile.id;
}

beforeEach(() => {
  store = new MemoryStore();
});

describe("analyzeResume — surfaces gaps as follow-up questions", () => {
  it("asks at most five questions, led by the highest-priority gaps", async () => {
    const id = await seedThinProfile();
    await generateResume(store, ai, id);

    const analysis = await analyzeResume(store, ai, id);
    expect(analysis.overallImpression.length).toBeGreaterThan(0);
    expect(analysis.strengths.length).toBeGreaterThan(0);

    const qids = analysis.improvements.map((i) => i.questionId);
    expect(analysis.improvements.length).toBe(MAX_FEEDBACK_QUESTIONS_PER_ITERATION);
    expect(qids).toContain("languages_any");
    expect(qids).toContain("skills_add"); // only 1 confirmed skill
    // Thin experience surfaces at least one experience follow-up.
    expect(qids.some((q) => q === "experience_results" || q === "experience_scope")).toBe(true);
    // A reserved slot goes to the personalized deep-dive, which scores lowest on
    // priority and would otherwise be cut entirely by the cap.
    expect(qids).toContain("experience_deepen");

    // Every improvement is routable (has a real section + inputType + question)
    // and carries the answer limit the UI shows and enforces.
    for (const imp of analysis.improvements) {
      expect(imp.section.length).toBeGreaterThan(0);
      expect(imp.followUpQuestion.length).toBeGreaterThan(0);
      expect(imp.charLimit).toBeGreaterThan(0);
    }
  });

  it("falls back to deterministic gaps when the AI analysis fails (no hard error)", async () => {
    const id = await seedThinProfile();
    await generateResume(store, ai, id);

    // Provider whose AI analysis blows up (validation/truncation/network).
    const flaky = Object.assign(Object.create(Object.getPrototypeOf(ai)), ai, {
      analyzeResume: async () => {
        throw new Error("La IA no devolvió una respuesta válida.");
      },
    });

    const analysis = await analyzeResume(store, flaky, id);
    // Still returns routable follow-ups instead of throwing — and still capped.
    expect(analysis.improvements.length).toBeGreaterThan(0);
    expect(analysis.improvements.length).toBeLessThanOrEqual(MAX_FEEDBACK_QUESTIONS_PER_ITERATION);
    const qids = analysis.improvements.map((i) => i.questionId);
    expect(qids).toContain("languages_any");
  });

  it("resolving a gap frees its slot for one the cap had crowded out", async () => {
    const id = await seedThinProfile();
    await generateResume(store, ai, id);
    let qids = (await analyzeResume(store, ai, id)).improvements.map((i) => i.questionId);
    // Round 1: languages is shown (priority 4); interests (priority 5) does not fit.
    expect(qids).toContain("languages_any");
    expect(qids).not.toContain("interests");

    // Provide the languages, regenerate, re-analyze.
    await store.createLanguage(id, { name: "Español", speakingLevel: "nativo" });
    await generateResume(store, ai, id);
    qids = (await analyzeResume(store, ai, id)).improvements.map((i) => i.questionId);

    expect(qids).not.toContain("languages_any"); // resolved, so it drops out
    expect(qids).toContain("interests"); // and the freed slot goes to the next gap
  });

  it("holds slots for deep-dives without starving them of gaps", async () => {
    // Four thin experiences produce four deep-dives, all at the fallback priority.
    const id = await seedThinProfile();
    for (const org of ["Tienda", "Parroquia", "Taller"]) {
      await store.createExperience(id, {
        experienceType: "informal_work",
        organization: org,
        responsibilities: ["Ayudaba"],
        confirmationStatus: "confirmed",
      });
    }
    await generateResume(store, ai, id);

    const qids = (await analyzeResume(store, ai, id)).improvements.map((i) => i.questionId);
    expect(qids.length).toBe(MAX_FEEDBACK_QUESTIONS_PER_ITERATION);
    // Two reserved for deep-dives, three for the top gaps — neither side takes over.
    expect(qids.filter((q) => q === "experience_deepen").length).toBe(DEEP_DIVE_SLOTS);
    expect(qids.filter((q) => q !== "experience_deepen").length).toBe(
      MAX_FEEDBACK_QUESTIONS_PER_ITERATION - DEEP_DIVE_SLOTS,
    );
  });
});

describe("analyzeResume — answer limits travel with each follow-up", () => {
  it("gives every improvement a limit the API will actually accept", async () => {
    const id = await seedThinProfile();
    await generateResume(store, ai, id);
    const analysis = await analyzeResume(store, ai, id);

    for (const imp of analysis.improvements) {
      // An answer AT the limit passes the same validation the /answers route runs.
      const atLimit = "a".repeat(imp.charLimit);
      const parsed = AnswerBody.safeParse({ questionId: imp.questionId, section: "skills", rawAnswer: atLimit });
      // Non-catalog follow-ups ("interests", the deep-dives) never reach /answers,
      // so only assert parity for the ones that do.
      if (getCatalogQuestion(imp.questionId)) expect(parsed.success).toBe(true);
      // And the limit is never looser than what the server would enforce there.
      expect(imp.charLimit).toBeLessThanOrEqual(answerCharLimitForQuestion(imp.questionId));
    }
  });

  it("uses the catalog limit for catalog-backed follow-ups", async () => {
    const id = await seedThinProfile();
    await generateResume(store, ai, id);
    const analysis = await analyzeResume(store, ai, id);

    const skills = analysis.improvements.find((i) => i.questionId === "skills_add");
    expect(skills?.charLimit).toBe(getCatalogQuestion("skills_add")!.charLimit);
  });
});

describe("analyzeResume — personalized entry deep-dives", () => {
  it("asks a deep-dive about a specific thin project, targeting its entryId", async () => {
    const profile = await store.createResumeProfile("u1", { careerGoal: "Analista", targetRole: "Analista" });
    await store.upsertPersonalInformation(profile.id, { firstName: "Leo", email: "l@e.com" });
    await store.createExperience(profile.id, {
      experienceType: "formal_employment",
      responsibilities: ["Analizaba datos", "Preparaba reportes"],
      confirmationStatus: "confirmed",
    });
    const project = await store.createProject(profile.id, {
      name: "Simulador Monte Carlo para VOO",
      confirmationStatus: "confirmed",
    });
    await store.createSkill(profile.id, { name: "Análisis de datos", status: "confirmed" });
    await generateResume(store, ai, profile.id);

    const analysis = await analyzeResume(store, ai, profile.id);
    const deepDive = analysis.improvements.find(
      (i) => i.entryType === "project" && i.entryId === project.id,
    );
    expect(deepDive).toBeTruthy();
    expect(deepDive!.questionId).toBe("project_deepen");
    expect(deepDive!.followUpQuestion).toContain("Simulador Monte Carlo para VOO");
  });
});

describe("enrichEntry — appends deep-dive detail to a specific entry", () => {
  it("enriches a project without overwriting existing data", async () => {
    const profile = await store.createResumeProfile("u1", {});
    const project = await store.createProject(profile.id, {
      name: "Simulador Monte Carlo para VOO",
      responsibilities: ["Modelé escenarios de precios"],
      confirmationStatus: "confirmed",
    });

    await enrichEntry(store, ai, profile.id, "project", project.id, "Usé Python y NumPy para simular 10000 caminos");

    const updated = await store.getProject(project.id);
    expect(updated!.responsibilities).toContain("Modelé escenarios de precios"); // kept
    expect(updated!.responsibilities.join(" ")).toContain("Python"); // appended
    expect(updated!.description ?? "").toContain("Python");
  });

  it("enriches an experience and extracts tools", async () => {
    const profile = await store.createResumeProfile("u1", {});
    const exp = await store.createExperience(profile.id, {
      experienceType: "informal_work",
      responsibilities: ["Atendía la tienda"],
      confirmationStatus: "confirmed",
    });

    await enrichEntry(store, ai, profile.id, "experience", exp.id, "Usaba una caja registradora todo el día");

    const updated = await store.getExperience(exp.id);
    expect(updated!.responsibilities).toContain("Atendía la tienda"); // kept
    expect(updated!.tools.join(" ").toLowerCase()).toContain("caja registradora"); // extracted
  });

  // The deep-dive charLimit is the same promise as a catalog question's (see
  // answer-limits-roundtrip.test.ts): an answer AT the limit must survive.
  it("accepts a deep-dive answer at exactly the limit the UI allows", async () => {
    const profile = await store.createResumeProfile("u1", {});
    const exp = await store.createExperience(profile.id, {
      experienceType: "informal_work",
      confirmationStatus: "confirmed",
    });
    const limit = followUpCharLimit("experience_deepen", "long_text");
    const filler =
      "Atendía a los clientes en el mostrador, cobraba en la caja registradora, " +
      "organizaba la mercancía en los estantes y revisaba el inventario cada semana. ";
    let answer = "";
    while (answer.length < limit) answer += filler;

    await expect(
      enrichEntry(store, ai, profile.id, "experience", exp.id, answer.slice(0, limit)),
    ).resolves.toEqual({ affectedEntryId: exp.id });
  });
});

describe("generateResume — richer bullets from captured facts", () => {
  it("expands one experience into multiple bullets using tools, people and metrics", async () => {
    const id = (await store.createResumeProfile("u1", { targetRole: "Vendedora", careerGoal: "Vendedora" })).id;
    await store.upsertPersonalInformation(id, { firstName: "Ana", email: "a@e.com" });
    await store.createExperience(id, {
      experienceType: "informal_work",
      organization: "Tienda",
      responsibilities: ["Vendía ropa"],
      tools: ["caja registradora"],
      peopleServed: "clientes de la tienda",
      metrics: ["aproximadamente 20 clientes por día"],
      confirmationStatus: "confirmed",
    });
    await store.createSkill(id, { name: "Ventas", status: "confirmed" });

    const { resume } = await generateResume(store, ai, id);
    const bullets = resume.experience.flatMap((e) => e.bullets);
    // 1 responsibility + tools + peopleServed + metrics → more than one bullet.
    expect(bullets.length).toBeGreaterThanOrEqual(3);
    const text = bullets.map((b) => b.text.toLowerCase()).join(" | ");
    expect(text).toContain("caja registradora");
    expect(text).toContain("clientes");
    // Approximate quantity preserved verbatim.
    expect(text).toContain("aproximadamente 20");
  });
});
