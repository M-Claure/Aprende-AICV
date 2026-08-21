import "server-only";
import { getEnv } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { MemoryRateLimiter, NoopRateLimiter, type RateLimiter } from "./rate-limiter";
import { SupabaseRateLimiter } from "./supabase-rate-limiter";

export type { RateLimiter } from "./rate-limiter";
export { MemoryRateLimiter, NoopRateLimiter } from "./rate-limiter";
export {
  LIMITS,
  clientIp,
  isOverLimit,
  rateLimitKey,
  type LimitedOperation,
  type LimitRule,
} from "./policy";

/**
 * The memory limiter must outlive one request for the same reason
 * `getMemoryResumeFileStore()` does: Next re-instantiates route modules, and a
 * module-scoped instance would give every route its own empty counter.
 */
const globalForLimiter = globalThis as unknown as { __mcvRateLimiter?: MemoryRateLimiter };

function memoryLimiter(): MemoryRateLimiter {
  if (!globalForLimiter.__mcvRateLimiter) {
    globalForLimiter.__mcvRateLimiter = new MemoryRateLimiter();
  }
  return globalForLimiter.__mcvRateLimiter;
}

/** Logged at most once per process, so a missing key is loud but not a flood. */
let warnedNoServiceRole = false;

/**
 * Resolve the counter backend.
 *
 * Enforcement needs `SUPABASE_SERVICE_ROLE_KEY`, because the counting function is
 * executable only by `service_role` (the anon key ships to browsers, so anything it
 * can call an attacker can call — with any key it likes). Without that variable the
 * app keeps working and this returns a no-op limiter: a configuration gap must not
 * take the product down, but it must not be silent either.
 */
export function getRateLimiter(): RateLimiter {
  const env = getEnv();
  if (env.USAGE_LIMITS === "off") return new NoopRateLimiter();
  if (env.PERSISTENCE !== "supabase") return memoryLimiter();

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    if (!warnedNoServiceRole) {
      warnedNoServiceRole = true;
      console.error(
        "[rate-limit] SUPABASE_SERVICE_ROLE_KEY is not set, so rate limits and spend " +
          "caps are NOT being enforced. Set it (Supabase → Project Settings → API) " +
          "or set USAGE_LIMITS=off to make this deliberate.",
      );
    }
    return new NoopRateLimiter();
  }

  return new SupabaseRateLimiter(getSupabaseServiceClient());
}
