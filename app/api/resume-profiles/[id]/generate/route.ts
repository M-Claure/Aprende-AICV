import { handleRoute, ok } from "@/lib/http";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { generateResume } from "@/lib/resume/resume-generator";
import { MAX_RESUME_ITERATIONS } from "@/lib/config/limits";
import { Errors } from "@/lib/errors";

export const dynamic = "force-dynamic";
// Chromium cold start + render, on top of the model call, comfortably exceeds
// Vercel's 10s default. 60s is the Hobby ceiling and is plenty for one résumé.
export const maxDuration = 60;
// This route renders the PDF too (via `resumeArtifacts`), so it needs the
// Node.js runtime and its filesystem — never Edge.
export const runtime = "nodejs";

/**
 * POST /api/resume-profiles/:id/generate
 * Generate a resume from confirmed data only. Returns 409 (not_ready) with the
 * missing critical fields if the profile isn't ready.
 *
 * The FIRST generation is free; each one after it is an improvement round and
 * counts against MAX_RESUME_ITERATIONS. That cap used to live only in the
 * browser's localStorage, so clearing site data reset it — it is server state
 * now (`funnel.iteration`) and is enforced here.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store, ai, analytics, resumeArtifacts } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);

    // A résumé already on file means this call is a regeneration, i.e. the end
    // of an improvement round.
    const isRegeneration = (await store.getLatestGeneratedResume(params.id)) !== null;
    const completed = await store.getIteration(params.id);
    if (isRegeneration && completed >= MAX_RESUME_ITERATIONS) {
      throw Errors.conflict(
        `Ya mejoraste tu currículum ${MAX_RESUME_ITERATIONS} veces. Revísalo y descárgalo.`,
      );
    }

    analytics.track("resume_generation_started", { resumeProfileId: params.id }, userId);
    await store.updateResumeProfile(params.id, { status: "generating" });

    // `resumeArtifacts` renders the PDF and replaces the profile's stored one.
    const { resume } = await generateResume(store, ai, params.id, resumeArtifacts);

    // A freshly (re)generated résumé is not finalized — the user must review and
    // finalize the new version before downloading it. (`generateResume` has
    // already recorded the funnel as complete — see `runGeneration`.)
    await store.updateResumeProfile(params.id, { status: "generated", finalizedAt: null });
    const iteration = isRegeneration
      ? await store.advanceIteration(params.id, MAX_RESUME_ITERATIONS)
      : completed;
    analytics.track("resume_generated", { resumeProfileId: params.id, version: resume.version }, userId);

    return ok({ resume, iteration });
  });
}
