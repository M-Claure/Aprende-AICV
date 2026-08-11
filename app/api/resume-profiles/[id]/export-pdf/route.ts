import { NextResponse } from "next/server";
import { handleRoute } from "@/lib/http";
import { Errors } from "@/lib/errors";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { generateResume } from "@/lib/resume/resume-generator";
import { getPdfGenerator } from "@/lib/resume/pdf-generator";

export const dynamic = "force-dynamic";
// PDF rendering (Chromium) needs the Node.js runtime, not Edge.
export const runtime = "nodejs";

/**
 * POST /api/resume-profiles/:id/export-pdf
 * Streams a PDF of the latest generated resume (generating one first if needed).
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store, ai, analytics } = await getRequestContext();
    const profile = await loadOwnedProfile(store, params.id, userId);

    // Download is gated behind finalization: the user must explicitly finish the
    // CV before it can be exported.
    if (!profile.finalizedAt) {
      throw Errors.notReady("Finaliza tu currículum antes de descargarlo.");
    }

    analytics.track("pdf_export_started", { resumeProfileId: params.id }, userId);

    let resume = await store.getLatestGeneratedResume(params.id);
    if (!resume) {
      resume = (await generateResume(store, ai, params.id)).resume;
    }
    if (!resume.html) throw Errors.notReady("El currículum aún no tiene contenido para exportar.");

    const pdf = await getPdfGenerator().generate(resume.html);

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
