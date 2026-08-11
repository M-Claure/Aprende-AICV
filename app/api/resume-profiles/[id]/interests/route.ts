import { handleRoute, ok, readJson } from "@/lib/http";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { SetInterestsBody } from "@/lib/validation/api-schemas";

export const dynamic = "force-dynamic";

/** PATCH /api/resume-profiles/:id/interests — replace the interests list. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);
    const { interests } = SetInterestsBody.parse(await readJson(request));
    // Dedupe (case-insensitive) while preserving order.
    const seen = new Set<string>();
    const deduped = interests.filter((i) => {
      const k = i.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const profile = await store.updateResumeProfile(params.id, { interests: deduped });
    return ok({ interests: profile.interests });
  });
}
