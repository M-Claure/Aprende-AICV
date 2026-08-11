import { created, handleRoute, readJson } from "@/lib/http";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { CreateExperienceBody } from "@/lib/validation/api-schemas";

export const dynamic = "force-dynamic";

/** POST /api/resume-profiles/:id/experience — add a user-provided experience entry. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store, analytics } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);
    const body = CreateExperienceBody.parse(await readJson(request));

    const entry = await store.createExperience(params.id, {
      ...body,
      source: "user_entered",
      confirmationStatus: "confirmed",
    });
    analytics.track(
      "experience_entry_added",
      { resumeProfileId: params.id, experienceType: entry.experienceType },
      userId,
    );
    return created({ entry });
  });
}
