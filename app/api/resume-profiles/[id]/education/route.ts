import { created, handleRoute, readJson } from "@/lib/http";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { CreateEducationBody } from "@/lib/validation/api-schemas";

export const dynamic = "force-dynamic";

/** POST /api/resume-profiles/:id/education — add a user-provided education entry. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store, analytics } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);
    const body = CreateEducationBody.parse(await readJson(request));

    const entry = await store.createEducation(params.id, {
      ...body,
      source: "user_entered",
      confirmationStatus: "confirmed",
    });
    analytics.track("education_entry_added", { resumeProfileId: params.id }, userId);
    return created({ entry });
  });
}
