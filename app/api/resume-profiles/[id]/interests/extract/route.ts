import { handleRoute, ok, readJson } from "@/lib/http";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { enforceRateLimit, funnelProviderForBudget } from "@/lib/services/usage-guard";
import { ExtractInterestsBody } from "@/lib/validation/api-schemas";

export const dynamic = "force-dynamic";

/**
 * POST /api/resume-profiles/:id/interests/extract
 * Take a free-text interests answer, extract the GENUINE interests (a negation
 * like "not really" yields none), and append them to the profile's interests.
 * Uses the funnel provider (Azure OpenAI when AI_PROVIDER=azure, else deterministic).
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store, funnelAi } = await getRequestContext(params.id);
    const profile = await loadOwnedProfile(store, params.id, userId);
    await enforceRateLimit("assist", { userId });

    const { rawAnswer } = ExtractInterestsBody.parse(await readJson(request));
    const existing = profile.interests ?? [];

    // `extractInterests` is one of the ops the hybrid provider sends to the model,
    // so it costs money — and it is capture, so it degrades instead of refusing.
    const ai = await funnelProviderForBudget({ funnelAi, userId, resumeProfileId: params.id });
    const { interests: extracted } = await ai.extractInterests({ rawAnswer, existing });

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
