import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { NoopAnalytics } from "@/lib/analytics";
import { processAnswer, type PipelineContext } from "@/lib/services/answer-pipeline";
import { AnswerNormalizationSchema } from "@/lib/ai/schemas";

let store: MemoryStore;
let ctx: PipelineContext;
let profileId: string;

beforeEach(async () => {
  store = new MemoryStore();
  ctx = { store, ai: new MockAIProvider(), analytics: new NoopAnalytics(), userId: "user-1" };
  const profile = await store.createResumeProfile("user-1", {});
  profileId = profile.id;
});

async function answer(
  questionId: string,
  section: Parameters<typeof processAnswer>[1]["section"],
  rawAnswer: string,
) {
  return processAnswer(ctx, { profileId, questionId, section, rawAnswer });
}

describe("processAnswer — adaptive flow (spec §17 scenario)", () => {
  it("walks a family-business user from career goal to a ready profile", async () => {
    // 1. Career goal.
    let res = await answer("career_goal_target", "career_goal", "Asistente administrativa");
    expect(res.profileState.careerGoal).toBe("Asistente administrativa");
    expect(res.nextQuestion.section).toBe("personal_information");
    expect(res.nextQuestion.questionId).toBe("personal_name");

    // 2. Name.
    res = await answer("personal_name", "personal_information", "María García López");
    expect(res.profileState.personalInformation.firstName).toBe("María");
    expect(res.nextQuestion.questionId).toBe("personal_contact");

    // 3. Contact → moves on to education (education-first for low experience).
    res = await answer("personal_contact", "personal_information", "maria@example.com");
    expect(res.profileState.personalInformation.hasEmail).toBe(true);
    expect(res.nextQuestion.section).toBe("education");

    // 4. Education.
    res = await answer(
      "education_highest",
      "education",
      "Terminé la secundaria y estudié seis meses de administración",
    );
    expect(res.profileState.education.length).toBe(1);
    // The AI-extracted education entry needs confirmation.
    expect(res.interpretation?.needsConfirmation).toBe(true);

    // 5. Experience add — creates an entry and preserves raw wording.
    res = await answer(
      "experience_add",
      "experience",
      "Ayudaba en el negocio de limpieza de mi mamá",
    );
    expect(res.profileState.experience.length).toBe(1);
    expect(res.profileState.experience[0]!.rawDescription).toContain("limpieza");
    expect(res.profileState.experience[0]!.experienceType).toBe("family_business");

    // 6. Experience detail — produces evidence-backed skill suggestions.
    res = await answer(
      "experience_daily_tasks",
      "experience",
      "Respondía llamadas y organizaba las citas de los clientes",
    );
    const suggestedNames = res.profileState.suggestedSkills.map((s) => s.name);
    expect(suggestedNames).toEqual(
      expect.arrayContaining(["Atención al cliente", "Comunicación telefónica"]),
    );
    for (const s of res.profileState.suggestedSkills) {
      expect(s.status).toBe("suggested"); // never auto-confirmed
      expect(s.evidence).toBeTruthy();
    }
    // Next step is to confirm the suggested skills.
    expect(res.nextQuestion.questionId).toBe("skills_confirm");
    expect(res.nextQuestion.inputType).toBe("skill_confirmation");

    // 7. Confirm a subset of skills.
    const toConfirm = res.profileState.suggestedSkills.slice(0, 2).map((s) => s.id);
    const toReject = res.profileState.suggestedSkills.slice(2).map((s) => s.id);
    res = await processAnswer(ctx, {
      profileId,
      questionId: "skills_confirm",
      section: "skills",
      skillDecisions: { confirm: toConfirm, reject: toReject },
    });
    expect(res.profileState.confirmedSkills.length).toBe(2);
    expect(res.profileState.completeness.readyToGenerate).toBe(true);
  });
});

describe("processAnswer — no repeats & skip handling", () => {
  it("never re-asks an already answered question", async () => {
    const res = await answer("career_goal_target", "career_goal", "Vendedora");
    expect(res.profileState.answeredQuestionIds).toContain("career_goal_target");
    // The next question must not be the one just answered.
    expect(res.nextQuestion.questionId).not.toBe("career_goal_target");
  });

  it("records a skip and does not immediately re-ask it", async () => {
    await answer("career_goal_target", "career_goal", "Vendedora");
    await answer("personal_name", "personal_information", "Ana Ruiz");
    await answer("personal_contact", "personal_information", "ana@e.com");
    // Skip the optional location question.
    const res = await processAnswer(ctx, {
      profileId,
      questionId: "personal_location",
      section: "personal_information",
      skipped: true,
    });
    expect(res.profileState.skippedQuestionIds).toContain("personal_location");
    expect(res.nextQuestion.questionId).not.toBe("personal_location");
  });
});

describe("processAnswer — back-edit overwrites, add creates (multiple experiences)", () => {
  it("re-answering with targetEntryId overwrites; without it adds another", async () => {
    // First experience → creates entry A.
    const r1 = await answer("experience_add", "experience", "Ayudaba en el negocio de limpieza de mi mamá");
    expect(r1.profileState.experience.length).toBe(1);
    const a = r1.affectedEntryId!;
    expect(a).toBeTruthy();

    // Back + re-answer with targetEntryId → overwrite the SAME entry (no duplicate).
    const r2 = await processAnswer(ctx, {
      profileId,
      questionId: "experience_add",
      section: "experience",
      rawAnswer: "Trabajé en una tienda vendiendo ropa",
      targetEntryId: a,
    });
    expect(r2.profileState.experience.length).toBe(1);
    expect(r2.affectedEntryId).toBe(a);
    expect(r2.profileState.experience[0]!.rawDescription).toContain("tienda");

    // Add another experience (no targetEntryId) → a new entry.
    const r3 = await answer("experience_add", "experience", "Cuidaba a mi abuela y sus citas médicas");
    expect(r3.profileState.experience.length).toBe(2);
    expect(r3.affectedEntryId).not.toBe(a);
  });
});

describe("processAnswer — no formal employment path", () => {
  it("reaches a ready profile through caregiving experience", async () => {
    await answer("career_goal_target", "career_goal", "Cuidadora de personas");
    await answer("personal_name", "personal_information", "Lucía Pérez");
    await answer("personal_contact", "personal_information", "999888777");
    await answer("education_highest", "education", "Secundaria completa");
    await answer("experience_add", "experience", "Cuidaba a mi abuela y le daba sus medicamentos");
    const res = await answer(
      "experience_daily_tasks",
      "experience",
      "Organizaba sus citas médicas y compraba sus medicinas",
    );
    // Confirm any suggested skills.
    const ids = res.profileState.suggestedSkills.map((s) => s.id);
    const final = await processAnswer(ctx, {
      profileId,
      questionId: "skills_confirm",
      section: "skills",
      skillDecisions: { confirm: ids },
    });
    expect(final.profileState.completeness.readyToGenerate).toBe(true);
    expect(final.profileState.completeness.readiness).not.toBe("insufficient_information");
  });
});

/**
 * Claude legitimately returns a BLANK identifying name when the answer was a
 * deep-dive about an entry we already have (a project deep-dive describes tools
 * and outcomes, not what the project is called). A `min(1)` on that field used to
 * fail the whole normalization with a 502 — "La IA no devolvió una respuesta
 * válida." — throwing away a 600-character answer. Caught by a live run of the
 * improvement loop; see `optionalName` in lib/ai/schemas.ts.
 */
describe("processAnswer — a blank entry name never fails the answer", () => {
  const blankNameProvider = (base: MockAIProvider, key: "projects" | "certifications" | "achievements") =>
    Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
      normalizeAnswer: async () =>
        AnswerNormalizationSchema.parse({
          interpretationSummary: "Registré tu respuesta.",
          needsConfirmation: false,
          updates:
            key === "achievements"
              ? { achievements: [{ title: "   ", description: "Usé Python y NumPy" }] }
              : { [key]: [{ name: "", description: "Usé Python y NumPy", tools: ["Python"] }] },
          suggestedSkills: [],
        }),
    });

  for (const key of ["projects", "certifications", "achievements"] as const) {
    it(`accepts a blank ${key} name and keeps the rest of the answer`, async () => {
      const ai = blankNameProvider(new MockAIProvider(), key);
      const result = await processAnswer(
        { store, ai, analytics: new NoopAnalytics(), userId: "user-1" },
        {
          profileId,
          questionId: "projects_any",
          section: "projects",
          rawAnswer: "Usé Python y NumPy para simular diez mil caminos de precios",
        },
      );
      // The answer is accepted and recorded verbatim…
      expect(result.profileState).toBeDefined();
      const turns = await store.listConversationTurns(profileId);
      expect(turns.at(-1)?.userAnswer).toContain("Python");
      // …and no nameless entry is written.
      expect(await store.listProjects(profileId)).toHaveLength(0);
    });
  }
});
