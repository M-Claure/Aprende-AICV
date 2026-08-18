import "server-only";
import type { ResumeProfile } from "@/types";
import { getAIProvider, getFunnelProvider, type AIProvider } from "@/lib/ai";
import { getAnalytics, type Analytics } from "@/lib/analytics";
import { getEnv } from "@/lib/env";
import { Errors } from "@/lib/errors";
import { getStore, type Store } from "@/lib/repositories";
import { resolveUserEmail, resolveUserId } from "@/lib/auth";

export interface RequestContext {
  userId: string;
  store: Store;
  /** Configured provider (Azure OpenAI when enabled) — generation + analysis only. */
  ai: AIProvider;
  /** Deterministic provider — per-step funnel/capture ops (never the paid model). */
  funnelAi: AIProvider;
  analytics: Analytics;
}

/**
 * Build the per-request dependency bundle: authenticated user + persistence +
 * AI provider + analytics. Throws 401 when no user can be resolved. In memory
 * mode the app-level user row is provisioned on the fly (Supabase does this via
 * a DB trigger).
 */
export async function getRequestContext(): Promise<RequestContext> {
  const userId = await resolveUserId();
  if (!userId) throw Errors.unauthorized();

  const store = getStore();
  const env = getEnv();

  if (env.PERSISTENCE === "memory") {
    const existing = await store.getUser(userId);
    if (!existing) {
      const email = (await resolveUserEmail()) ?? `${userId}@local.dev`;
      await store.upsertUser({ id: userId, email });
    }
  }

  return {
    userId,
    store,
    ai: getAIProvider(),
    funnelAi: getFunnelProvider(),
    analytics: getAnalytics(),
  };
}

/**
 * Load a resume profile and assert the caller owns it. Returns notFound (not
 * forbidden) on mismatch so profile existence is never leaked across accounts.
 */
export async function loadOwnedProfile(
  store: Store,
  profileId: string,
  userId: string,
): Promise<ResumeProfile> {
  const profile = await store.getResumeProfile(profileId);
  if (!profile || profile.userId !== userId) throw Errors.notFound("Perfil no encontrado");
  return profile;
}

/**
 * Assert the caller owns the profile a child entity belongs to. Used by the
 * flat entity routes (/api/education/:id, /api/skills/:id, ...).
 */
export async function assertOwnsProfileId(
  store: Store,
  profileId: string,
  userId: string,
): Promise<void> {
  await loadOwnedProfile(store, profileId, userId);
}
