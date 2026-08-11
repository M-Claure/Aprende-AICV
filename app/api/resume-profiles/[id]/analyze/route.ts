import { handleRoute, ok } from "@/lib/http";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { analyzeResume } from "@/lib/resume/resume-analyzer";

export const dynamic = "force-dynamic";

/**
 * POST /api/resume-profiles/:id/analyze
 * Critiques the latest generated résumé and returns targeted follow-up
 * questions to improve it (the improvement loop).
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store, ai } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);
    const analysis = await analyzeResume(store, ai, params.id);
    return ok({ analysis });
  });
}
