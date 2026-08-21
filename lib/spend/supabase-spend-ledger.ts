import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SpendState } from "./budget";
import { ZERO_SPEND, type SpendEntry, type SpendLedger } from "./spend-ledger";

/**
 * Postgres-backed ledger, shared across serverless instances.
 *
 * Both calls go through functions granted only to `service_role`, for the reason
 * spelled out in `0009_usage_limits.sql`: the anon key is public, so an
 * anon-executable `record_ai_spend` would let anyone write junk rows and trip the
 * daily cap for every user.
 */
export class SupabaseSpendLedger implements SpendLedger {
  constructor(private readonly client: SupabaseClient) {}

  async record(entry: SpendEntry): Promise<void> {
    const { error } = await this.client.rpc("record_ai_spend", {
      p_user: entry.userId,
      p_profile: entry.resumeProfileId,
      p_operation: entry.operation,
      p_model: entry.model,
      p_input: entry.inputTokens,
      p_output: entry.outputTokens,
      p_cached: entry.cachedTokens,
      p_usd: entry.usdEstimate,
    });
    if (error) {
      // Never throws: the call already happened and was already billed, so the
      // response owes the user their résumé, not an error about bookkeeping. The
      // cost is that this spend is invisible to the caps — hence error level.
      console.error(`[spend] could not record ${entry.operation}:`, error.message);
    }
  }

  async state(userId: string | null, resumeProfileId: string | null): Promise<SpendState> {
    const { data, error } = await this.client.rpc("ai_spend_state", {
      p_user: userId,
      p_profile: resumeProfileId,
    });

    if (error) {
      /*
       * Fail OPEN, like the rate limiter. Failing closed would mean one unhealthy
       * table refuses every résumé in the product — a self-inflicted outage in
       * response to a database hiccup. Logged so the gap is visible.
       */
      console.error("[spend] totals unavailable; allowing:", error.message);
      return ZERO_SPEND;
    }

    // `returns table (…)` arrives as an array of rows; one row, or none.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return ZERO_SPEND;

    // numeric(12,6) comes back as a string over the wire — Number() it rather than
    // comparing a string against a cap, which would compare lexicographically.
    return {
      profileUsd: Number(row.profile_usd ?? 0),
      userUsd: Number(row.user_usd ?? 0),
      globalDayUsd: Number(row.global_day_usd ?? 0),
    };
  }
}
