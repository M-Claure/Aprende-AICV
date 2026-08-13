/**
 * The hard cap of MAX_EXPERIENCE_ENTRIES experiences, enforced in CODE at every
 * write path — not only in the counter UI's copy.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { NoopAnalytics } from "@/lib/analytics";
import { MAX_EXPERIENCE_ENTRIES } from "@/lib/config/limits";
import { processAnswer, type PipelineContext } from "@/lib/services/answer-pipeline";
import type { AIProvider } from "@/lib/ai";
import type { AnswerNormalization } from "@/lib/ai/schemas";

let store: MemoryStore;
let ctx: PipelineContext;
let profileId: string;

beforeEach(async () => {
  store = new MemoryStore();
  ctx = { store, ai: new MockAIProvider(), analytics: new NoopAnalytics(), userId: "user-1" };
  const profile = await store.createResumeProfile("user-1", {});
  profileId = profile.id;
});

/** A provider that always asks for `count` brand-new experience entries. */
function greedyProvider(count: number): AIProvider {
  const mock = new MockAIProvider();
  return {
    name: "greedy",
    planNextQuestion: (p) => mock.planNextQuestion(p),
    suggestSkills: () => Promise.resolve([]),
    extractInterests: (p) => mock.extractInterests(p),
    generateResumeContent: (p) => mock.generateResumeContent(p),
    analyzeResume: (p) => mock.analyzeResume(p),
    proofreadResume: (p) => mock.proofreadResume(p),
    async normalizeAnswer(): Promise<AnswerNormalization> {
      return {
        interpretationSummary: "Anoté tus experiencias.",
        needsConfirmation: false,
        suggestedSkills: [],
        updates: {
          experienceEntries: Array.from({ length: count }, (_, i) => ({
            experienceType: "informal_work" as const,
            rawDescription: `Experiencia ${i + 1}`,
            responsibilities: [`Tarea ${i + 1}`],
          })),
        },
      };
    },
  };
}

describe("experience cap — counter step", () => {
  it("creates at most MAX_EXPERIENCE_ENTRIES entries from a counts answer", async () => {
    // Asks for 9 across three types; only the cap's worth may be created.
    await processAnswer(ctx, {
      profileId,
      questionId: "experience_type_counts",
      section: "experience",
      rawAnswer: JSON.stringify({ formal_employment: 3, caregiving: 4, volunteering: 2 }),
    });

    const list = await store.listExperience(profileId);
    expect(list.length).toBe(MAX_EXPERIENCE_ENTRIES);
  });

  it("caps a single type asking for more than the limit", async () => {
    await processAnswer(ctx, {
      profileId,
      questionId: "experience_type_counts",
      section: "experience",
      rawAnswer: JSON.stringify({ caregiving: 20 }),
    });

    expect((await store.listExperience(profileId)).length).toBe(MAX_EXPERIENCE_ENTRIES);
  });

  it("keeps counts under the limit untouched", async () => {
    await processAnswer(ctx, {
      profileId,
      questionId: "experience_type_counts",
      section: "experience",
      rawAnswer: JSON.stringify({ caregiving: 2 }),
    });

    expect((await store.listExperience(profileId)).length).toBe(2);
  });
});

describe("experience cap — the pipeline is the gate, not the provider", () => {
  it("drops the entries that do not fit when the model returns too many", async () => {
    const greedy = greedyProvider(MAX_EXPERIENCE_ENTRIES + 3);
    const result = await processAnswer(
      { ...ctx, ai: greedy },
      { profileId, questionId: "experience_add", section: "experience", rawAnswer: "Varias cosas" },
    );

    const list = await store.listExperience(profileId);
    expect(list.length).toBe(MAX_EXPERIENCE_ENTRIES);
    // The answer still succeeds — what fit was captured, nothing 500s.
    expect(result.interpretation?.summary).toBeTruthy();
    expect(result.affectedEntryId).not.toBeNull();
  });

  it("creates nothing more once the profile is already at the cap", async () => {
    for (let i = 0; i < MAX_EXPERIENCE_ENTRIES; i++) {
      await store.createExperience(profileId, {
        experienceType: "informal_work",
        rawDescription: `Existente ${i + 1}`,
        responsibilities: ["Ya descrita"],
      });
    }

    await processAnswer(
      { ...ctx, ai: greedyProvider(2) },
      { profileId, questionId: "experience_add", section: "experience", rawAnswer: "Una más" },
    );

    const list = await store.listExperience(profileId);
    expect(list.length).toBe(MAX_EXPERIENCE_ENTRIES);
    expect(list.map((x) => x.rawDescription)).not.toContain("Experiencia 1");
  });
});

describe("experience cap — the funnel stops asking", () => {
  it("does not offer another experience question once the cap is described", async () => {
    await processAnswer(ctx, {
      profileId,
      questionId: "experience_type_counts",
      section: "experience",
      rawAnswer: JSON.stringify({ caregiving: MAX_EXPERIENCE_ENTRIES }),
    });

    let last;
    for (let i = 0; i < MAX_EXPERIENCE_ENTRIES; i++) {
      last = await processAnswer(ctx, {
        profileId,
        questionId: "experience_add",
        section: "experience",
        rawAnswer: `Cuidaba a una persona mayor, turno ${i + 1}. Le daba sus medicamentos.`,
      });
    }

    expect((await store.listExperience(profileId)).length).toBe(MAX_EXPERIENCE_ENTRIES);
    expect(last!.nextQuestion.questionId).not.toBe("experience_add");
    expect(last!.nextQuestion.questionId).not.toBe("experience_type_counts");
  });
});
