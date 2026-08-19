import { handleRoute, ok, readJson } from "@/lib/http";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { assembleProfileState } from "@/lib/profile-state";
import { PatchProfileBody } from "@/lib/validation/api-schemas";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

/** GET /api/resume-profiles/:id — profile + owner-facing personal info + state. */
export async function GET(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    const profile = await loadOwnedProfile(store, params.id, userId);
    const [personalInformation, state, iteration] = await Promise.all([
      store.getPersonalInformation(params.id),
      assembleProfileState(store, params.id),
      // Improvement rounds completed. Kept off `ResumeProfile` itself so it can
      // only be changed through the clamped `advanceIteration`, never a PATCH.
      store.getIteration(params.id),
    ]);
    return ok({ profile, personalInformation, state, iteration });
  });
}

/** PATCH /api/resume-profiles/:id — update career goal / target role / location. */
export async function PATCH(request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);
    const body = PatchProfileBody.parse(await readJson(request));

    const profile = await store.updateResumeProfile(params.id, {
      targetRole: body.targetRole ?? undefined,
      careerGoal: body.careerGoal ?? undefined,
      location: body.location ?? undefined,
    });
    const state = await assembleProfileState(store, params.id);
    return ok({ profile, state });
  });
}
