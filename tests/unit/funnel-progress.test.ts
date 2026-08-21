import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { NoopAnalytics } from "@/lib/analytics";
import { processAnswer, type PipelineContext } from "@/lib/services/answer-pipeline";
import { assembleProfileState } from "@/lib/profile-state";
import { planNextQuestion } from "@/lib/question-engine/adaptive-planner";
import { generateResume } from "@/lib/resume/resume-generator";
import {
  advanceFunnelProgress,
  estimateFunnelProgress,
} from "@/lib/question-engine/funnel-progress";
import { eligibleQuestions } from "@/lib/question-engine/question-prioritizer";
import { profileState, readyProfile, stateFrom } from "../helpers/factories";
import type { AdaptiveQuestion } from "@/lib/ai/schemas";
import type { ResumeProfileState } from "@/types";

/**
 * The progress bar, which used to be `completeness.overallScore`.
 *
 * The two defects that motivated the change (both reproduced below by driving the
 * real funnel): it sat on the same number for several questions in a row, and
 * finishing the funnel left it in the seventies/eighties — never 100 — because
 * readiness fires while the optional buckets are still empty.
 */

let store: MemoryStore;
let ctx: PipelineContext;

beforeEach(() => {
  store = new MemoryStore();
  ctx = { store, ai: new MockAIProvider(), analytics: new NoopAnalytics(), userId: "u1" };
});

function answerFor(q: AdaptiveQuestion): string {
  const t = q.questionText.toLowerCase();
  if (q.section === "career_goal") return "Asistente administrativa";
  if (t.includes("nombre")) return "María García López";
  if (t.includes("correo") || t.includes("teléfono")) return "maria@example.com";
  if (q.section === "education") return "Secundaria completa";
  if (t.includes("día normal")) return "Respondía llamadas y organizaba las citas";
  if (q.section === "experience") return "Ayudaba en el negocio de limpieza de mi mamá";
  if (t.includes("otras habilidades")) return "Trabajo en equipo, puntualidad";
  return "Sí";
}

/** Drive the funnel to review, recording the stored progress at every step. */
async function driveFunnel(): Promise<{ id: string; trail: number[] }> {
  const profile = await store.createResumeProfile("u1", {});
  const id = profile.id;
  let state: ResumeProfileState = await assembleProfileState(store, id);
  let q = await planNextQuestion(state, ctx.ai);
  const trail: number[] = [];

  for (let step = 0; step < 40; step++) {
    if (q.section === "review") break;
    await processAnswer(ctx, {
      profileId: id,
      questionId: q.questionId,
      section: q.section,
      ...(q.inputType === "skill_confirmation"
        ? { skillDecisions: { confirm: state.suggestedSkills.map((s) => s.id) } }
        : { rawAnswer: answerFor(q) }),
    });
    trail.push((await store.getResumeProfile(id))!.progressPercentage);
    state = await assembleProfileState(store, id);
    q = await planNextQuestion(state, ctx.ai);
  }
  return { id, trail };
}

describe("the bar keeps moving", () => {
  it("advances on every single answer, with no repeated value", async () => {
    const { trail } = await driveFunnel();

    expect(trail.length).toBeGreaterThan(4);
    // The old score produced runs of identical values — three questions in a row
    // at 57 on this very path — which is what "stuck at 77" felt like.
    for (let i = 1; i < trail.length; i++) {
      expect(trail[i], `step ${i} did not move (trail: ${trail.join(",")})`).toBeGreaterThan(
        trail[i - 1]!,
      );
    }
  });

  it("never goes backwards, even when an answer opens new questions", async () => {
    const { trail } = await driveFunnel();
    expect(trail).toEqual([...trail].sort((a, b) => a - b));
  });

  it("absorbs a grown denominator instead of dropping", () => {
    // Answering the experience counter tells the funnel how many entries exist,
    // which opens a follow-up per entry: the raw estimate falls. The floor turns
    // that into a small step forward rather than a visible loss of progress.
    expect(advanceFunnelProgress(43, 29)).toBe(44);
    expect(advanceFunnelProgress(43, 43)).toBe(44);
    // Once the estimate is ahead again it takes over — the floor is not a crawl.
    expect(advanceFunnelProgress(43, 62)).toBe(62);
  });
});

describe("finishing the funnel shows 100", () => {
  it("stores 100 once there is nothing left to ask", async () => {
    const { id } = await driveFunnel();

    // The complaint: this used to be 82 on this path (and 77 on others).
    expect((await store.getResumeProfile(id))!.progressPercentage).toBe(100);
  });

  it("stores 100 when the user generates with optional questions outstanding", async () => {
    // A user can be ready to generate before the funnel runs dry, so the pipeline
    // alone would leave the stored value short of 100 forever.
    const profile = await store.createResumeProfile("u1", {});
    await store.upsertPersonalInformation(profile.id, { firstName: "Ana", email: "a@e.com" });
    await store.createExperience(profile.id, {
      experienceType: "informal_work",
      organization: "Tienda",
      responsibilities: ["Vendía ropa"],
      confirmationStatus: "confirmed",
    });
    await store.createSkill(profile.id, { name: "Ventas", status: "confirmed" });
    await store.updateResumeProfile(profile.id, { careerGoal: "Vendedora", progressPercentage: 62 });

    expect((await store.getResumeProfile(profile.id))!.progressPercentage).toBe(62);

    await generateResume(store, ctx.ai, profile.id);

    expect((await store.getResumeProfile(profile.id))!.progressPercentage).toBe(100);
  });

  it("reaches 100 only when the funnel is out of questions", () => {
    const ready = stateFrom(readyProfile());
    const remaining = eligibleQuestions(ready).filter((q) => q.id !== "review_summary").length;
    const estimate = estimateFunnelProgress(ready);

    if (remaining > 0) expect(estimate).toBeLessThan(100);
    else expect(estimate).toBe(100);
    // Never overshoots into a bar that reads full with a question still on screen.
    expect(advanceFunnelProgress(98, 99)).toBe(99);
    expect(advanceFunnelProgress(99, 99)).toBe(99);
  });
});

describe("estimate boundaries", () => {
  it("is 0 for a profile that has answered nothing", () => {
    expect(estimateFunnelProgress(profileState())).toBe(0);
  });

  it("counts a skipped question as dealt with", () => {
    const none = estimateFunnelProgress(profileState());
    const skipped = estimateFunnelProgress(
      profileState({ skippedQuestionIds: ["personal_location"] }),
    );
    // Otherwise a user who skips a lot would watch the bar refuse to move.
    expect(skipped).toBeGreaterThan(none);
  });

  it("ignores stored ids the catalog no longer has", () => {
    // A question renamed or dropped in a later release must not inflate progress
    // past what the denominator knows about.
    const real = profileState({ answeredQuestionIds: ["personal_name"] });
    const withGhost = profileState({
      answeredQuestionIds: ["personal_name", "a_question_that_was_removed"],
    });
    expect(estimateFunnelProgress(withGhost)).toBe(estimateFunnelProgress(real));
  });
});
