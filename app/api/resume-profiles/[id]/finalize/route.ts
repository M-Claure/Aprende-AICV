import { handleRoute, ok } from "@/lib/http";
import { Errors } from "@/lib/errors";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";

export const dynamic = "force-dynamic";

/**
 * POST /api/resume-profiles/:id/finalize
 * Mark the résumé as finalized (locked for download). Requires a generated
 * résumé to exist. Returns the updated profile.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store, analytics } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);

    const resume = await store.getLatestGeneratedResume(params.id);
    if (!resume) {
      throw Errors.notReady("Genera tu currículum antes de finalizarlo.");
    }

    const profile = await store.updateResumeProfile(params.id, { finalizedAt: new Date().toISOString() });
    analytics.track("resume_finalized", { resumeProfileId: params.id, version: resume.version }, userId);
    return ok({ profile });
  });
}

/**
 * DELETE /api/resume-profiles/:id/finalize
 * Reopen a finalized résumé for further editing (clears finalizedAt).
 */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);
    const profile = await store.updateResumeProfile(params.id, { finalizedAt: null });
    return ok({ profile });
  });
}
