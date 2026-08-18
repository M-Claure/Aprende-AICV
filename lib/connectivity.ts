/**
 * Runtime connectivity guard.
 *
 * Verifies that the host actually has a working network path to the app's
 * external services. Used by `middleware.ts` to block every request with a 503
 * while offline, so the product cannot be used without a connection.
 *
 * Deliberately dependency-free and edge-safe: it uses only `fetch`,
 * `AbortController`, and `Date.now()` (all available in the Edge runtime) and
 * does NOT import `server-only`, `lib/env`, or any Node built-in — middleware
 * runs on the Edge runtime where those are unavailable.
 */

const PROBE_TIMEOUT_MS = 2500;
const CACHE_TTL_MS = 15_000;

let cachedResult: boolean | null = null;
let cachedAt = 0;

/**
 * The URL we probe for reachability. Prefer the app's own Supabase backend when
 * configured (its `/auth/v1/health` endpoint is a cheap 200); otherwise fall
 * back to the configured Azure OpenAI endpoint. We only care whether the
 * *network* reaches the host — any HTTP response (even 401/404) proves
 * connectivity; only a network failure or timeout counts as offline.
 */
function probeUrl(): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl) {
    return `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/health`;
  }
  // `lib/env` is server-only and this runs on the Edge runtime, so the raw var is
  // read directly. An unauthenticated GET is enough: we want a TCP+TLS round trip,
  // not a valid answer.
  const azureUrl = process.env.AZURE_OPENAI_BASE_URL;
  if (azureUrl) {
    return `${azureUrl.replace(/\/+$/, "")}/models`;
  }
  return "https://api.openai.com/v1/models";
}

/**
 * Returns whether the app currently has network connectivity to its external
 * services. Result is cached for {@link CACHE_TTL_MS} so we probe at most once
 * per window rather than on every request.
 */
export async function isOnline(): Promise<boolean> {
  const now = Date.now();
  if (cachedResult !== null && now - cachedAt < CACHE_TTL_MS) {
    return cachedResult;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  let online = false;
  try {
    // Any resolved response = the host is reachable = we're online. A rejected
    // promise (DNS failure, connection refused, abort/timeout) = offline.
    await fetch(probeUrl(), {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    online = true;
  } catch {
    online = false;
  } finally {
    clearTimeout(timer);
  }

  cachedResult = online;
  cachedAt = now;
  return online;
}

/** Test/ops hook: forget the cached connectivity result. */
export function __resetConnectivityCache(): void {
  cachedResult = null;
  cachedAt = 0;
}
