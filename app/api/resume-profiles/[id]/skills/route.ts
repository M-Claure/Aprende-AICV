import { created, handleRoute, readJson } from "@/lib/http";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { addUserSkill } from "@/lib/skills/skill-confirmation";
import { AddSkillsBody } from "@/lib/validation/api-schemas";

export const dynamic = "force-dynamic";

/**
 * POST /api/resume-profiles/:id/skills — add user-declared skills (confirmed).
 * Accepts a list of names; existing suggestions with the same name are promoted
 * to confirmed rather than duplicated.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);
    const { names } = AddSkillsBody.parse(await readJson(request));

    const skills = [];
    for (const name of names) skills.push(await addUserSkill(store, params.id, { name }));
    return created({ skills });
  });
}
