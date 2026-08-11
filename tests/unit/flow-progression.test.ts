import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { NoopAnalytics } from "@/lib/analytics";
import { processAnswer, type PipelineContext } from "@/lib/services/answer-pipeline";
import { assembleProfileState } from "@/lib/profile-state";
import { planNextQuestion } from "@/lib/question-engine/adaptive-planner";
import { buildCandidates } from "@/lib/question-engine/question-prioritizer";
import { computeCompleteness } from "@/lib/question-engine/completeness-engine";
import type { AdaptiveQuestion } from "@/lib/ai/schemas";
import type { ResumeProfileState } from "@/types";
import { readyProfile } from "../helpers/factories";

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
  if (t.includes("día normal")) return "Respondía llamadas y organizaba las citas de los clientes";
  if (q.section === "experience") return "Ayudaba en el negocio de limpieza de mi mamá";
  if (t.includes("otras habilidades")) return "Trabajo en equipo, puntualidad";
  return "Sí";
}

/** Drive the flow to review; fail if any question repeats too many times. */
async function driveToReview(skillMode: "confirm" | "reject"): Promise<string[]> {
  const profile = await store.createResumeProfile("u1", {});
  const id = profile.id;
  let state: ResumeProfileState = await assembleProfileState(store, id);
  let q = await planNextQuestion(state, ctx.ai);

  const counts: Record<string, number> = {};
  const trail: string[] = [];

  for (let step = 0; step < 40; step++) {
    counts[q.questionId] = (counts[q.questionId] ?? 0) + 1;
    trail.push(q.questionId);
    expect(counts[q.questionId], `"${q.questionId}" was asked too many times (loop)`).toBeLessThanOrEqual(2);

    if (q.section === "review") break;

    const res = await processAnswer(ctx, {
      profileId: id,
      questionId: q.questionId,
      section: q.section,
      ...(q.inputType === "skill_confirmation"
        ? {
            skillDecisions:
              skillMode === "confirm"
                ? { confirm: state.suggestedSkills.map((s) => s.id) }
                : { reject: state.suggestedSkills.map((s) => s.id) },
          }
        : { rawAnswer: answerFor(q) }),
    });
    state = res.profileState;
    q = res.nextQuestion;
  }
  return trail;
}

describe("flow progression — no loops (regression for skills_add)", () => {
  it("reaches review when confirming suggested skills", async () => {
    const trail = await driveToReview("confirm");
    expect(trail[trail.length - 1]).toBe("review_summary");
  });

  it("reaches review even when rejecting all suggested skills (via skills_add once)", async () => {
    const trail = await driveToReview("reject");
    expect(trail[trail.length - 1]).toBe("review_summary");
    // skills_add must appear at most once — never a loop.
    expect(trail.filter((q) => q === "skills_add").length).toBeLessThanOrEqual(1);
  });
});

describe("prioritizer — repeatable questions drop once ready", () => {
  it("does not offer repeatable 'add another' questions once the profile is ready", () => {
    const base = readyProfile();
    const state: ResumeProfileState = { ...base, completeness: computeCompleteness(base) };
    expect(state.completeness.readyToGenerate).toBe(true);
    const ids = buildCandidates(state).map((c) => c.questionId);
    expect(ids).toContain("review_summary");
    expect(ids).not.toContain("experience_add"); // repeatable → dropped when ready
  });
});
