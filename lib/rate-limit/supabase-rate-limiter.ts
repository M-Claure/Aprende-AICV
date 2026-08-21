import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RateLimiter } from "./rate-limiter";

/**
 * Postgres-backed counter, shared across every serverless instance.
 *
 * Goes through the `rate_limit_hit` function rather than reading and writing the
 * table, for two reasons:
 *
 *  1. **Atomicity.** The function is a single `insert … on conflict do update …
 *     returning`, so two concurrent requests cannot both observe the last free
 *     slot. A read-then-write from the app could.
 *  2. **Reachability.** `EXECUTE` is granted only to `service_role`, which lives
 *     server-side. The anon key is in the browser bundle, so anything anon can
 *     execute an attacker can execute directly — including burning someone else's
 *     quota by passing their key.
 *
 * Requires the SERVICE-ROLE client (see `0009_usage_limits.sql`).
 */
export class SupabaseRateLimiter implements RateLimiter {
  constructor(private readonly client: SupabaseClient) {}

  async hit(key: string, windowSeconds: number): Promise<number> {
    const { data, error } = await this.client.rpc("rate_limit_hit", {
      p_key: key,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      /*
       * Fail OPEN. A counter that cannot be reached must not become an outage:
       * the alternative is that one unhealthy table stops every résumé in the
       * product. Logged at error level so the gap is visible rather than assumed
       * — a burst of these next to a spend spike is the signal that matters.
       */
      console.error(`[rate-limit] counter unavailable for ${key}; allowing:`, error.message);
      return 0;
    }

    // The function returns a bare integer; a null would mean the RPC shape changed.
    return typeof data === "number" ? data : 0;
  }
}
