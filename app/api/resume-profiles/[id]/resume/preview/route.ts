import { NextResponse } from "next/server";
import { handleRoute } from "@/lib/http";
import { Errors } from "@/lib/errors";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/resume-profiles/:id/resume/preview
 * Returns the rendered resume as HTML (for an <iframe> preview).
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);
    const resume = await store.getLatestGeneratedResume(params.id);
    if (!resume?.html) throw Errors.notFound("Aún no se ha generado un currículum.");
    return new NextResponse(resume.html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  });
}
