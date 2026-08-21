import { NextResponse } from "next/server";
import { handleRoute } from "@/lib/http";
import { Errors } from "@/lib/errors";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { enforceRateLimit } from "@/lib/services/usage-guard";
import { generateResume } from "@/lib/resume/resume-generator";
import { getPdfGenerator } from "@/lib/resume/pdf-generator";

export const dynamic = "force-dynamic";
// Chromium cold start + render, on top of the model call, comfortably exceeds
// Vercel's 10s default. 60s is the Hobby ceiling and is plenty for one résumé.
export const maxDuration = 60;
// PDF rendering (Chromium) needs the Node.js runtime, not Edge.
export const runtime = "nodejs";

/**
 * POST /api/resume-profiles/:id/export-pdf
 * Streams the PDF of the latest generated resume.
 *
 * Since every generation now saves a PDF (see `lib/resume/resume-artifacts.ts`),
 * the common path is a storage read rather than a Chromium launch. Rendering is
 * kept as the fallback for the two cases where nothing is stored: a résumé
 * generated before this feature existed, or a save that failed (the writer is
 * deliberately best-effort). That fallback also back-fills the stored file, so a
 * profile self-heals after one download.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store, ai, analytics, resumeFiles, resumeArtifacts } =
      await getRequestContext(params.id);
    const profile = await loadOwnedProfile(store, params.id, userId);
    // No tokens here, so no budget check — but each call may cold-start Chromium
    // inside a 60s function, which is the cheapest way to exhaust concurrency.
    await enforceRateLimit("export_pdf", { userId });

    // Download is gated behind finalization: the user must explicitly finish the
    // CV before it can be exported.
    if (!profile.finalizedAt) {
      throw Errors.notReady("Finaliza tu currículum antes de descargarlo.");
    }

    analytics.track("pdf_export_started", { resumeProfileId: params.id }, userId);

    let resume = await store.getLatestGeneratedResume(params.id);
    if (!resume) {
      resume = (await generateResume(store, ai, params.id, resumeArtifacts)).resume;
    }
    if (!resume.html) throw Errors.notReady("El currículum aún no tiene contenido para exportar.");

    // Prefer the saved file — the one for the résumé's own round, since a profile
    // now holds up to four. `getResumePdf` returns null for a missing object, so a
    // stale `pdfPath` (file removed out of band) falls through to a re-render.
    let pdf = resume.pdfPath
      ? await resumeFiles.getResumePdf({
          userId,
          profileId: params.id,
          stage: resume.stage,
        })
      : null;

    if (!pdf) {
      pdf = await getPdfGenerator().generate(resume.html);
      // Back-fill so the next download is a storage read. Best-effort: a failure
      // here must not block a download we can already satisfy from memory.
      await resumeArtifacts.onResumeCreated(resume);
    }

    analytics.track("resume_downloaded", { resumeProfileId: params.id, version: resume.version }, userId);

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="curriculum.pdf"`,
        "Content-Length": String(pdf.byteLength),
      },
    });
  });
}
