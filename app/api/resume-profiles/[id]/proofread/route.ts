import { handleRoute, ok } from "@/lib/http";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { proofreadAndRerender } from "@/lib/resume/proofread-resume";

export const dynamic = "force-dynamic";
// Chromium cold start + render, on top of the model call, comfortably exceeds
// Vercel's 10s default. 60s is the Hobby ceiling and is plenty for one résumé.
export const maxDuration = 60;
// This route renders the PDF too (via `resumeArtifacts`), so it needs the
// Node.js runtime and its filesystem — never Edge.
export const runtime = "nodejs";

/**
 * POST /api/resume-profiles/:id/proofread
 * Runs a final AI spelling/grammar/formatting pass over the generated résumé and
 * saves the corrected version. Returns the new résumé + short notes on what was
 * corrected. Uses the paid model (ctx.ai) — it's a quality step, like generation.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store, ai, analytics, resumeArtifacts } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);

    const { resume, notes } = await proofreadAndRerender(store, ai, params.id, resumeArtifacts);

    analytics.track("resume_proofread", { resumeProfileId: params.id, version: resume.version }, userId);
    return ok({ resume, notes });
  });
}
