import { handleRoute, ok } from "@/lib/http";
import { Errors } from "@/lib/errors";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";

export const dynamic = "force-dynamic";

/** GET /api/resume-profiles/:id/resume — the latest generated resume (JSON). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);
    const resume = await store.getLatestGeneratedResume(params.id);
    if (!resume) throw Errors.notFound("Aún no se ha generado un currículum.");
    return ok({ resume });
  });
}
