import "server-only";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Resolve the authenticated user id.
 *  - supabase persistence → real Supabase Auth session (cookie-based).
 *  - E2E_AUTH_BYPASS      → fixed test user (Playwright).
 *  - memory persistence   → dev cookie `mcv_uid`, else a default dev user.
 *
 * Returns null when no user can be resolved (→ 401 in the route).
 */
export async function resolveUserId(): Promise<string | null> {
  const env = getEnv();

  if (env.E2E_AUTH_BYPASS) {
    return cookies().get("mcv_uid")?.value ?? "e2e-user";
  }

  if (env.PERSISTENCE === "supabase") {
    const supabase = getSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  }

  // Local/dev memory mode: keep the app usable without configured auth.
  return cookies().get("mcv_uid")?.value ?? "dev-user";
}

/** The email associated with the session, when available (best-effort). */
export async function resolveUserEmail(): Promise<string | null> {
  const env = getEnv();
  if (env.PERSISTENCE === "supabase" && !env.E2E_AUTH_BYPASS) {
    const { data } = await getSupabaseServerClient().auth.getUser();
    return data.user?.email ?? null;
  }
  return null;
}
