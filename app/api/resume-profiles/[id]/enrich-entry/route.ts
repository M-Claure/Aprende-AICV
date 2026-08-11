import { handleRoute, ok, readJson } from "@/lib/http";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { enrichEntry } from "@/lib/resume/entry-enrichment";
import { EnrichEntryBody } from "@/lib/validation/api-schemas";

export const dynamic = "force-dynamic";

/**
 * POST /api/resume-profiles/:id/enrich-entry
 * Appends a deep-dive answer to a specific experience/project entry (improvement loop).
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store, funnelAi } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);
    const { entryType, entryId, rawAnswer } = EnrichEntryBody.parse(await readJson(request));
    // Capturing the deep-dive detail is deterministic; Claude polishes on regenerate.
    const result = await enrichEntry(store, funnelAi, params.id, entryType, entryId, rawAnswer);
    return ok(result);
  });
}
