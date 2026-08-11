import { handleRoute, ok } from "@/lib/http";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { generateResume } from "@/lib/resume/resume-generator";

export const dynamic = "force-dynamic";

/**
 * POST /api/resume-profiles/:id/generate
 * Generate a resume from confirmed data only. Returns 409 (not_ready) with the
 * missing critical fields if the profile isn't ready.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store, ai, analytics } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);

    analytics.track("resume_generation_started", { resumeProfileId: params.id }, userId);
    await store.updateResumeProfile(params.id, { status: "generating" });

    const { resume } = await generateResume(store, ai, params.id);

    // A freshly (re)generated résumé is not finalized — the user must review and
    // finalize the new version before downloading it.
    await store.updateResumeProfile(params.id, { status: "generated", finalizedAt: null });
    analytics.track("resume_generated", { resumeProfileId: params.id, version: resume.version }, userId);

    return ok({ resume });
  });
}
