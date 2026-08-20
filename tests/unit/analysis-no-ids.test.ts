/**
 * No id ever reaches the screen.
 *
 * The analysis prompt hands the model every entry's id so it can target a
 * deep-dive (`entryId`), and asks it to name the experience it is asking about.
 * When the person skipped that section the entry is BLANK — no title, no
 * organization — so the only handle left is the id, and the model writes that:
 * «Cuéntame más sobre «a93ce414-1138-483c-b346-bfc020affd8c»». Reported from a
 * real run, hence a test rather than a prompt tweak.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { analyzeResume } from "@/lib/resume/resume-analyzer";
import type { ResumeAnalysisPayload } from "@/lib/ai/schemas";

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

let store: MemoryStore;
let profileId: string;
let blankEntryId: string;

beforeEach(async () => {
  store = new MemoryStore();
  const profile = await store.createResumeProfile("u1", { careerGoal: "Vendedora" });
  profileId = profile.id;
  // A blank experience: exactly what skipping the section leaves behind.
  const entry = await store.createExperience(profileId, { experienceType: "other" });
  blankEntryId = entry.id;
  await store.createGeneratedResume(profileId, {
    professionalSummary: "Resumen",
    skills: [],
    experience: [],
    education: [],
    certifications: [],
    projects: [],
    languages: [],
    html: "<html></html>",
  });
});

/**
 * A provider that echoes the entry id into every user-facing string, exactly as
 * observed in the reported run. Subclassed rather than spread: `MockAIProvider`'s
 * methods live on the prototype, so `{...new MockAIProvider()}` would drop them.
 */
class IdLeakingProvider extends MockAIProvider {
  constructor(private readonly entryId: string) {
    super();
  }

  override async analyzeResume(): Promise<ResumeAnalysisPayload> {
    const id = this.entryId;
    return {
      overallImpression: `El currículum de ${id} necesita más detalle.`,
      strengths: [`Buena base en ${id}`, "Objetivo claro"],
      improvements: [
        {
          questionId: "experience_deepen",
          entryId: id,
          title: `Cuéntame más sobre «${id}»`,
          detail: `Detalle de ${id}`,
          followUpQuestion: `Sobre «${id}»: ¿qué herramientas usaste?`,
        },
      ],
    };
  }
}

/** Well-behaved output, to prove the scrub is not rewriting clean text. */
class CleanProvider extends MockAIProvider {
  override async analyzeResume(): Promise<ResumeAnalysisPayload> {
    return {
      overallImpression: "Buen inicio, falta detalle.",
      strengths: ["Objetivo claro"],
      improvements: [
        {
          questionId: "languages_any",
          title: "Agrega los idiomas que hablas",
          detail: "Los idiomas abren puertas.",
          followUpQuestion: "¿Qué idiomas hablas y cuánto?",
        },
      ],
    };
  }
}

describe("analysis never shows an id", () => {
  it("strips ids the model echoed into questions, titles and prose", async () => {
    const analysis = await analyzeResume(store, new IdLeakingProvider(blankEntryId), profileId);

    const shown = [
      analysis.overallImpression,
      ...analysis.strengths,
      ...analysis.improvements.flatMap((i) => [i.title, i.followUpQuestion, i.detail ?? ""]),
    ];
    for (const text of shown) {
      expect(text).not.toContain(blankEntryId);
      expect(text).not.toMatch(UUID_RE);
    }
  });

  it("keeps the deep-dive routable and readable after scrubbing", async () => {
    const analysis = await analyzeResume(store, new IdLeakingProvider(blankEntryId), profileId);
    const deep = analysis.improvements.find((i) => i.questionId === "experience_deepen");

    // entryId still targets the entry — it is routing data, never displayed.
    expect(deep?.entryId).toBe(blankEntryId);
    // And the question that replaced the id is a real question, not a fragment.
    expect(deep?.followUpQuestion).toContain("esta experiencia");
    expect(deep?.followUpQuestion.length).toBeGreaterThan(20);
    expect(deep?.title).not.toMatch(/«\s*»/);
  });

  it("leaves clean model output alone", async () => {
    const analysis = await analyzeResume(store, new CleanProvider(), profileId);
    expect(analysis.overallImpression).toBe("Buen inicio, falta detalle.");
    expect(analysis.strengths).toEqual(["Objetivo claro"]);
    const lang = analysis.improvements.find((i) => i.questionId === "languages_any");
    expect(lang?.followUpQuestion).toBe("¿Qué idiomas hablas y cuánto?");
  });
});
