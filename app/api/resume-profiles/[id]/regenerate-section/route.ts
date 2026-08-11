import { handleRoute, ok, readJson } from "@/lib/http";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { generateResume } from "@/lib/resume/resume-generator";
import { RegenerateSectionBody } from "@/lib/validation/api-schemas";

export const dynamic = "force-dynamic";

/**
 * POST /api/resume-profiles/:id/regenerate-section
 * Milestone behavior: regeneration is holistic — it produces a fresh resume
 * version (still from confirmed data only) and returns it. The requested section
 * is echoed so the UI can scroll to / highlight it.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store, ai, analytics } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);
    const { section } = RegenerateSectionBody.parse(await readJson(request));

    const { resume } = await generateResume(store, ai, params.id);
    analytics.track(
      "resume_section_edited",
      { resumeProfileId: params.id, section, version: resume.version },
      userId,
    );
    return ok({ resume, regeneratedSection: section });
  });
}
