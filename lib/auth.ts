import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";
import { Errors } from "@/lib/errors";
import { getSupabaseServerClient, getSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * There is **no login and no sign-up** in this product. A visitor lands on the
 * page, answers the first question and their work is saved — nobody is asked for
 * a password to write a résumé.
 *
 * The database still needs one identity per visitor: `funnel.user_id` references
 * `auth.users(id)`, every RLS policy authorizes on `auth.uid()`, and the Storage
 * policies key the résumé PDF on the same id. So instead of removing auth we make
 * it invisible — the first request that needs a user id creates a **guest
 * session** and the browser carries it in the usual Supabase cookies. Same
 * isolation guarantees as before; one less screen between a person and their CV.
 *
 * Two ways to mint that session, tried in order:
 *   1. `signInAnonymously()` — the native path. Requires "Allow anonymous
 *      sign-ins" to be enabled for the Supabase project.
 *   2. A service-role-provisioned account with random credentials, used when the
 *      project has anonymous sign-ins turned off (see `provisionGuestUser`).
 *
 * Because the session lives only in the visitor's cookies, clearing them starts a
 * fresh résumé rather than recovering the old one. That is the accepted trade for
 * having no accounts: there is no identity to prove ownership with.
 */

/** Domain for the throwaway accounts of the fallback path. `.invalid` is reserved by RFC 2606, so it can never route. */
const GUEST_EMAIL_DOMAIN = "guest.invalid";

/**
 * Set once we learn this project has anonymous sign-ins turned off, so every
 * subsequent visitor goes straight to the fallback instead of paying a round-trip
 * to be told the same thing. Per-process and never un-set: enabling the provider
 * mid-run is a deploy-time change, and the worst case is one extra fallback.
 */
let anonymousSignInsDisabled = false;

/** True when the error says the provider is off, rather than that the call failed. */
function isProviderDisabled(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "anonymous_provider_disabled" ||
    /anonymous sign-?ins are disabled/i.test(error.message ?? "")
  );
}

/**
 * Resolve the user id for this request, starting a guest session when there is
 * none yet.
 *  - supabase persistence → existing session, else a new guest session.
 *  - E2E_AUTH_BYPASS      → fixed test user (Playwright).
 *  - memory persistence   → dev cookie `mcv_uid`, else a default dev user.
 *
 * Returns null only in the modes that cannot mint a session; the supabase path
 * throws instead, because a missing session there is a configuration fault and
 * "No autorizado" would tell the user to log in — which they cannot do.
 */
export async function resolveUserId(): Promise<string | null> {
  const env = getEnv();

  if (env.E2E_AUTH_BYPASS) {
    return cookies().get("mcv_uid")?.value ?? "e2e-user";
  }

  if (env.PERSISTENCE === "supabase") {
    const supabase = getSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) return data.user.id;
    return startGuestSession(supabase);
  }

  // Local/dev memory mode: keep the app usable without configured auth.
  return cookies().get("mcv_uid")?.value ?? "dev-user";
}

/**
 * Create the visitor's session. Called from route handlers only (via
 * `getRequestContext`), which is what makes the cookie write stick — a Server
 * Component cannot set cookies, and a session that is not persisted would mint a
 * new guest, and a new résumé, on every single request.
 */
async function startGuestSession(supabase: SupabaseClient): Promise<string> {
  let anonymousError = "skipped (provider known to be disabled)";

  if (!anonymousSignInsDisabled) {
    const anonymous = await supabase.auth.signInAnonymously();
    if (anonymous.data.user) return anonymous.data.user.id;
    if (isProviderDisabled(anonymous.error)) anonymousSignInsDisabled = true;
    anonymousError = anonymous.error?.message ?? "no session returned";
  }

  const provisioned = await provisionGuestUser(supabase);
  if (provisioned) return provisioned;

  // Operator detail stays in the logs; the user gets a plain Spanish sentence.
  console.error(
    '[auth] could not start a guest session. Enable "Allow anonymous sign-ins" ' +
      "(Supabase → Authentication → Sign In / Providers) or set SUPABASE_SERVICE_ROLE_KEY. " +
      `Anonymous sign-in said: ${anonymousError}`,
  );
  throw Errors.internal("No se pudo comenzar tu sesión. Vuelve a intentarlo en un momento.");
}

/**
 * Fallback for projects with anonymous sign-ins disabled: create a real user with
 * random credentials through the service role, then sign in as it on the
 * request-scoped client so the session lands in cookies and RLS sees a normal
 * `auth.uid()`.
 *
 * The credentials are generated per visitor, never shown, never stored and never
 * reused, so the session cookie is the only handle on the account — the same
 * property the anonymous path has.
 */
async function provisionGuestUser(supabase: SupabaseClient): Promise<string | null> {
  if (!getEnv().SUPABASE_SERVICE_ROLE_KEY) return null;

  const email = `guest-${randomUUID()}@${GUEST_EMAIL_DOMAIN}`;
  // 43 chars of base64url. Deliberately not two UUIDs: that is 73 characters and
  // Supabase rejects any password over 72, which fails the whole path.
  const password = randomBytes(32).toString("base64url");

  const created = await getSupabaseServiceClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    // `message` is sometimes an empty object on a 5xx from the auth API, so log the
    // name and status too — without them this failure is genuinely undebuggable.
    console.error(
      `[auth] guest provisioning failed: ${created.error?.name ?? "unknown"} ` +
        `status=${created.error?.status ?? "?"} ${JSON.stringify(created.error?.message ?? "")}`,
    );
    return null;
  }

  // Sign in on the cookie-bound client — the service client holds no session.
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    console.error(
      `[auth] guest sign-in failed: ${error?.name ?? "unknown"} ` +
        `status=${error?.status ?? "?"} ${JSON.stringify(error?.message ?? "")}`,
    );
    return null;
  }
  return data.user.id;
}

/**
 * The email associated with the session, when there is a real one (best-effort).
 *
 * Guest accounts have either no email (anonymous) or a throwaway `@guest.invalid`
 * address, which is not a way to reach anybody — it is filtered out here so no
 * caller mistakes it for a contact channel. The résumé's own email is captured in
 * the funnel's contact step, not taken from auth.
 */
export async function resolveUserEmail(): Promise<string | null> {
  const env = getEnv();
  if (env.PERSISTENCE === "supabase" && !env.E2E_AUTH_BYPASS) {
    const { data } = await getSupabaseServerClient().auth.getUser();
    const email = data.user?.email ?? null;
    if (!email || email.endsWith(`@${GUEST_EMAIL_DOMAIN}`)) return null;
    return email;
  }
  return null;
}
