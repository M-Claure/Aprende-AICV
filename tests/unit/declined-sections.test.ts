/**
 * "No tengo" is an answer, and the improvement loop has to respect it.
 *
 * Several FOLLOWUP_DEFS keys are also catalog question ids, so declining one in
 * the funnel lands in `skippedQuestionIds`. Without this the loop re-proposed the
 * same section every round — asking again for certificates the person had just
 * said they do not have.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { analyzeResume } from "@/lib/resume/resume-analyzer";
import { QUESTION_CATALOG } from "@/lib/question-engine/question-catalog";
import type { ResumeAnalysisPayload } from "@/lib/ai/schemas";

let store: MemoryStore;
let profileId: string;

/** The AI proposes the declined section too, so both filter paths are exercised. */
class PushesDeclinedProvider extends MockAIProvider {
  override async analyzeResume(): Promise<ResumeAnalysisPayload> {
    return {
      overallImpression: "Falta detalle.",
      strengths: ["Objetivo claro"],
      improvements: [
        {
          questionId: "languages_any",
          title: "Agrega los idiomas que hablas",
          detail: "Los idiomas abren puertas.",
          followUpQuestion: "¿Qué idiomas hablas?",
        },
      ],
    };
  }
}

beforeEach(async () => {
  store = new MemoryStore();
  const profile = await store.createResumeProfile("u1", {
    careerGoal: "Vendedora",
    targetRole: "Vendedora",
  });
  profileId = profile.id;
  await store.createExperience(profileId, {
    experienceType: "informal_work",
    title: "Cajera",
    rawDescription: "Atendía clientes en una tienda",
  });
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

/** What pressing "No tengo" on the languages question records. */
const declineLanguages = () =>
  store.upsertQuestionState(profileId, { skippedQuestionIds: ["languages_any"] });

describe("a declined section is not re-asked", () => {
  it("is proposed when nothing was declined", async () => {
    const analysis = await analyzeResume(store, new MockAIProvider(), profileId);
    expect(analysis.improvements.map((i) => i.questionId)).toContain("languages_any");
  });

  it("disappears from the deterministic gaps once declined", async () => {
    await declineLanguages();
    const analysis = await analyzeResume(store, new MockAIProvider(), profileId);
    expect(analysis.improvements.map((i) => i.questionId)).not.toContain("languages_any");
  });

  it("is dropped even when the model proposes it anyway", async () => {
    await declineLanguages();
    const analysis = await analyzeResume(store, new PushesDeclinedProvider(), profileId);
    expect(analysis.improvements.map((i) => i.questionId)).not.toContain("languages_any");
  });

  it("does not suppress the sections that were NOT declined", async () => {
    await declineLanguages();
    const analysis = await analyzeResume(store, new MockAIProvider(), profileId);
    expect(analysis.improvements.length).toBeGreaterThan(0);
  });
});

describe('skip buttons say what the person means', () => {
  const byId = (id: string) => QUESTION_CATALOG.find((q) => q.id === id);

  it('offers "No tengo" where that is the honest answer', () => {
    for (const id of ["certifications_any", "languages_any", "projects_any", "achievements_any"]) {
      expect(byId(id)?.skipLabel, id).toBe("No tengo");
    }
  });

  it("words the others for their own question", () => {
    expect(byId("education_highest")?.skipLabel).toBe("No estudié");
    expect(byId("career_goal_unknown")?.skipLabel).toBe("No sé todavía");
    expect(byId("personal_location")?.skipLabel).toBe("Prefiero no decir");
    expect(byId("skills_add")?.skipLabel).toBe("No tengo más");
  });

  it("never labels a question that cannot be skipped", () => {
    for (const q of QUESTION_CATALOG) {
      if (q.skipLabel) expect(q.allowSkip, q.id).toBe(true);
    }
  });
});
