import { handleRoute, ok } from "@/lib/http";
import { Errors } from "@/lib/errors";
import { assertOwnsProfileId, getRequestContext } from "@/lib/request-context";
import { confirmSkill } from "@/lib/skills/skill-confirmation";

export const dynamic = "force-dynamic";

/** POST /api/skills/:skillId/confirm — user confirms an inferred skill. */
export async function POST(_request: Request, { params }: { params: { skillId: string } }) {
  return handleRoute(async () => {
    const { userId, store, analytics } = await getRequestContext();
    const skill = await store.getSkill(params.skillId);
    if (!skill) throw Errors.notFound("Habilidad no encontrada");
    await assertOwnsProfileId(store, skill.resumeProfileId, userId);

    const updated = await confirmSkill(store, params.skillId);
    analytics.track("skill_confirmed", { resumeProfileId: skill.resumeProfileId, skillCount: 1 }, userId);
    return ok({ skill: updated });
  });
}
