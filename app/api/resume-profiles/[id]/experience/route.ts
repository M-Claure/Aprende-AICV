import { MAX_EXPERIENCE_ENTRIES } from "@/lib/config/limits";
import { Errors } from "@/lib/errors";
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

    // Hard cap, enforced server-side so the Review screen's "+ Agregar" button is
    // a courtesy and not the actual gate.
    const existing = await store.listExperience(params.id);
    if (existing.length >= MAX_EXPERIENCE_ENTRIES) {
      throw Errors.conflict(
        `Solo puedes tener ${MAX_EXPERIENCE_ENTRIES} experiencias. Borra una si quieres agregar otra.`,
      );
    }

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
