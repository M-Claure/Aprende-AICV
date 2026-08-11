import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import type { Analytics, AnalyticsEvent, AnalyticsProps } from "@/lib/analytics";
import { processAnswer, type PipelineContext } from "@/lib/services/answer-pipeline";
import { recordQuestionShown } from "@/lib/services/funnel-telemetry";

/** Captures events so we can assert the funnel emits what the dashboards need. */
class RecordingAnalytics implements Analytics {
  readonly events: Array<{ event: AnalyticsEvent; props: AnalyticsProps }> = [];
  track(event: AnalyticsEvent, props: AnalyticsProps): void {
    this.events.push({ event, props });
  }
  of(event: AnalyticsEvent): AnalyticsProps[] {
    return this.events.filter((e) => e.event === event).map((e) => e.props);
  }
}

let store: MemoryStore;
let analytics: RecordingAnalytics;
let ctx: PipelineContext;
let profileId: string;

beforeEach(async () => {
  store = new MemoryStore();
  analytics = new RecordingAnalytics();
  ctx = { store, ai: new MockAIProvider(), analytics, userId: "user-1" };
  const profile = await store.createResumeProfile("user-1", {});
  profileId = profile.id;
});

function answer(questionId: string, section: Parameters<typeof processAnswer>[1]["section"], rawAnswer: string, timeSpentMs?: number) {
  return processAnswer(ctx, { profileId, questionId, section, rawAnswer, timeSpentMs });
}

describe("effort telemetry persisted on conversation turns", () => {
  it("stores the time spent on an answer instead of discarding it", async () => {
    await answer("career_goal_target", "career_goal", "Asistente administrativa", 42_000);
    const [turn] = await store.listConversationTurns(profileId);
    expect(turn!.timeSpentMs).toBe(42_000);
  });

  it("records null timing when the client reports none", async () => {
    await answer("career_goal_target", "career_goal", "Vendedora");
    const [turn] = await store.listConversationTurns(profileId);
    expect(turn!.timeSpentMs).toBeNull();
  });

  it("counts attempts so re-answered questions are detectable", async () => {
    await answer("career_goal_target", "career_goal", "Vendedora");
    await answer("career_goal_target", "career_goal", "Asistente administrativa");
    await answer("career_goal_target", "career_goal", "Recepcionista");
    const attempts = (await store.listConversationTurns(profileId))
      .filter((t) => t.questionId === "career_goal_target")
      .map((t) => t.attemptNumber);
    expect(attempts).toEqual([1, 2, 3]);
  });

  it("keeps attempt counters independent per question", async () => {
    await answer("career_goal_target", "career_goal", "Vendedora");
    await answer("personal_name", "personal_information", "Ana Ruiz");
    const turns = await store.listConversationTurns(profileId);
    expect(turns.every((t) => t.attemptNumber === 1)).toBe(true);
  });

  it("records timing and attempt on a skip too", async () => {
    await processAnswer(ctx, {
      profileId,
      questionId: "personal_location",
      section: "personal_information",
      skipped: true,
      timeSpentMs: 3_000,
    });
    const [turn] = await store.listConversationTurns(profileId);
    expect(turn!.skipped).toBe(true);
    expect(turn!.timeSpentMs).toBe(3_000);
    expect(turn!.attemptNumber).toBe(1);
  });
});

describe("exit point tracking", () => {
  it("emits adaptive_question_shown for the question served after an answer", async () => {
    const res = await answer("career_goal_target", "career_goal", "Asistente administrativa");
    const shown = analytics.of("adaptive_question_shown");
    expect(shown).toHaveLength(1);
    expect(shown[0]!.questionId).toBe(res.nextQuestion.questionId);
    expect(shown[0]!.inputType).toBe(res.nextQuestion.inputType);
  });

  it("records the served question as the exit point in question state", async () => {
    const res = await answer("career_goal_target", "career_goal", "Asistente administrativa");
    const qs = await store.getQuestionState(profileId);
    // lastQuestionId = what they responded to; lastShownQuestionId = where they are now.
    expect(qs!.lastQuestionId).toBe("career_goal_target");
    expect(qs!.lastShownQuestionId).toBe(res.nextQuestion.questionId);
    expect(qs!.lastShownAt).toBeTruthy();
  });

  it("recordQuestionShown updates the exit point without an answer", async () => {
    await recordQuestionShown({ store, analytics, userId: "user-1" }, profileId, {
      questionId: "experience_add",
      section: "experience",
      inputType: "long_text",
    });
    const qs = await store.getQuestionState(profileId);
    expect(qs!.lastShownQuestionId).toBe("experience_add");
    expect(qs!.lastQuestionId).toBeNull();
    expect(analytics.of("adaptive_question_shown")[0]!.section).toBe("experience");
  });

  it("makes the abandoned question identifiable — shown but never answered", async () => {
    // The user answers one question, is served the next, then leaves.
    await answer("career_goal_target", "career_goal", "Asistente administrativa");
    const qs = await store.getQuestionState(profileId);
    const turns = await store.listConversationTurns(profileId);
    const respondedTo = new Set(turns.map((t) => t.questionId));
    expect(respondedTo.has(qs!.lastShownQuestionId!)).toBe(false);
  });
});

describe("analytics dimensions survive sanitization", () => {
  it("keeps attemptNumber and deviceCategory on the answered event", async () => {
    await processAnswer(ctx, {
      profileId,
      questionId: "career_goal_target",
      section: "career_goal",
      rawAnswer: "Vendedora",
      timeSpentMs: 5_000,
      deviceCategory: "mobile",
    });
    const [answered] = analytics.of("adaptive_question_answered");
    expect(answered!.deviceCategory).toBe("mobile");
    expect(answered!.attemptNumber).toBe(1);
    expect(answered!.timeSpentMs).toBe(5_000);
  });
});
