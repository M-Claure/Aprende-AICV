import { handleRoute, ok } from "@/lib/http";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { assembleProfileState } from "@/lib/profile-state";
import { planNextQuestion } from "@/lib/question-engine/adaptive-planner";
import { recordQuestionShown } from "@/lib/services/funnel-telemetry";

export const dynamic = "force-dynamic";

/** GET /api/resume-profiles/:id/next-question — the most useful next question. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const ctx = await getRequestContext();
    await loadOwnedProfile(ctx.store, params.id, ctx.userId);
    const state = await assembleProfileState(ctx.store, params.id);
    // Next-question planning is deterministic — no paid-model call per step.
    const nextQuestion = await planNextQuestion(state, ctx.funnelAi);
    await recordQuestionShown(ctx, params.id, nextQuestion);
    return ok({ nextQuestion, state });
  });
}
