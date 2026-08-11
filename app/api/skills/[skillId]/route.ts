import { handleRoute, ok, readJson } from "@/lib/http";
import { Errors } from "@/lib/errors";
import { assertOwnsProfileId, getRequestContext } from "@/lib/request-context";
import { editSkill } from "@/lib/skills/skill-confirmation";
import { EditSkillBody } from "@/lib/validation/api-schemas";

export const dynamic = "force-dynamic";

/** PATCH /api/skills/:skillId — rename/edit a skill (marks it `edited`). */
export async function PATCH(request: Request, { params }: { params: { skillId: string } }) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    const skill = await store.getSkill(params.skillId);
    if (!skill) throw Errors.notFound("Habilidad no encontrada");
    await assertOwnsProfileId(store, skill.resumeProfileId, userId);

    const body = EditSkillBody.parse(await readJson(request));
    const updated = await editSkill(store, params.skillId, body);
    return ok({ skill: updated });
  });
}
