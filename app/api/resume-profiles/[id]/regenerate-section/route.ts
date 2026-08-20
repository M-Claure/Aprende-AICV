import { handleRoute, ok, readJson } from "@/lib/http";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { generateResume } from "@/lib/resume/resume-generator";
import { RegenerateSectionBody } from "@/lib/validation/api-schemas";

export const dynamic = "force-dynamic";
// Chromium cold start + render, on top of the model call, comfortably exceeds
// Vercel's 10s default. 60s is the Hobby ceiling and is plenty for one résumé.
export const maxDuration = 60;
// This route renders the PDF too (via `resumeArtifacts`), so it needs the
// Node.js runtime and its filesystem — never Edge.
export const runtime = "nodejs";

/**
 * POST /api/resume-profiles/:id/regenerate-section
 * Milestone behavior: regeneration is holistic — it produces a fresh resume
 * version (still from confirmed data only) and returns it. The requested section
 * is echoed so the UI can scroll to / highlight it.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store, ai, analytics, resumeArtifacts } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);
    const { section } = RegenerateSectionBody.parse(await readJson(request));

    const { resume } = await generateResume(store, ai, params.id, resumeArtifacts);
    analytics.track(
      "resume_section_edited",
      { resumeProfileId: params.id, section, version: resume.version },
      userId,
    );
    return ok({ resume, regeneratedSection: section });
  });
}
