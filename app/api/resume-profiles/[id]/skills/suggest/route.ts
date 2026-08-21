import { handleRoute, ok } from "@/lib/http";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { enforceRateLimit } from "@/lib/services/usage-guard";
import { assembleProfileState } from "@/lib/profile-state";
import { inferAndPersistSkills } from "@/lib/skills/skill-inference";

export const dynamic = "force-dynamic";

/**
 * POST /api/resume-profiles/:id/skills/suggest
 * Generate evidence-backed skill suggestions from the current experience.
 * Suggestions are persisted with status `suggested` (never auto-confirmed).
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const ctx = await getRequestContext(params.id);
    await loadOwnedProfile(ctx.store, params.id, ctx.userId);
    // Skill inference is deterministic today, so there is nothing to degrade — but it
    // reads and writes the whole profile, so it still gets a ceiling.
    await enforceRateLimit("assist", { userId: ctx.userId });

    const state = await assembleProfileState(ctx.store, params.id);
    // Deterministic skill inference — no paid-model call.
    const suggested = await inferAndPersistSkills(ctx.store, ctx.funnelAi, state);
    if (suggested.length > 0) {
      ctx.analytics.track(
        "skill_suggested",
        { resumeProfileId: params.id, skillCount: suggested.length },
        ctx.userId,
      );
    }
    return ok({ suggestedSkills: suggested });
  });
}
