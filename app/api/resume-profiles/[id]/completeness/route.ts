import { handleRoute, ok } from "@/lib/http";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { assembleProfileState } from "@/lib/profile-state";

export const dynamic = "force-dynamic";

/** GET /api/resume-profiles/:id/completeness — deterministic completeness report. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);
    const state = await assembleProfileState(store, params.id);
    return ok({ completeness: state.completeness });
  });
}
