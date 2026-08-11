import { handleRoute, ok, readJson } from "@/lib/http";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { ExtractInterestsBody } from "@/lib/validation/api-schemas";

export const dynamic = "force-dynamic";

/**
 * POST /api/resume-profiles/:id/interests/extract
 * Take a free-text interests answer, extract the GENUINE interests (a negation
 * like "not really" yields none), and append them to the profile's interests.
 * Uses the funnel provider (Claude when AI_PROVIDER=anthropic, else deterministic).
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store, funnelAi } = await getRequestContext();
    const profile = await loadOwnedProfile(store, params.id, userId);

    const { rawAnswer } = ExtractInterestsBody.parse(await readJson(request));
    const existing = profile.interests ?? [];

    const { interests: extracted } = await funnelAi.extractInterests({ rawAnswer, existing });

    // Append, de-duped case-insensitively, preserving order (existing first).
    const seen = new Set(existing.map((i) => i.toLowerCase()));
    const merged = [...existing];
    for (const interest of extracted) {
      const key = interest.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(interest);
    }

    const updated = await store.updateResumeProfile(params.id, { interests: merged });
    return ok({ interests: updated.interests, added: extracted });
  });
}
