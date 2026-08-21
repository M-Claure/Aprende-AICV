import "server-only";
import { getEnv } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import type { SpendCaps } from "./budget";
import { MemorySpendLedger, NoopSpendLedger, type SpendLedger } from "./spend-ledger";
import { SupabaseSpendLedger } from "./supabase-spend-ledger";

export type { SpendLedger, SpendEntry } from "./spend-ledger";
export { MemorySpendLedger, NoopSpendLedger } from "./spend-ledger";
export {
  checkBudget,
  describeRefusal,
  type BudgetVerdict,
  type PaidOperation,
  type SpendCaps,
  type SpendState,
} from "./budget";

/** Survives route-module re-instantiation, like the other memory backends. */
const globalForLedger = globalThis as unknown as { __mcvSpendLedger?: MemorySpendLedger };

function memoryLedger(): MemorySpendLedger {
  if (!globalForLedger.__mcvSpendLedger) {
    globalForLedger.__mcvSpendLedger = new MemorySpendLedger();
  }
  return globalForLedger.__mcvSpendLedger;
}

/** The configured ceilings. Money, so they come from the environment. */
export function getSpendCaps(): SpendCaps {
  const env = getEnv();
  return {
    profileUsd: env.AI_SPEND_CAP_PROFILE_USD,
    userUsd: env.AI_SPEND_CAP_USER_USD,
    dailyUsd: env.AI_SPEND_CAP_DAILY_USD,
  };
}

/**
 * Resolve the ledger backend. Mirrors `getRateLimiter()` exactly, including the
 * no-service-role fallback: the two must be on or off together, or the app would
 * count requests while ignoring cost, or the reverse.
 */
export function getSpendLedger(): SpendLedger {
  const env = getEnv();
  if (env.USAGE_LIMITS === "off") return new NoopSpendLedger();
  if (env.PERSISTENCE !== "supabase") return memoryLedger();
  // The limiter logs the missing-key warning; duplicating it here would double
  // every line without adding information.
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return new NoopSpendLedger();
  return new SupabaseSpendLedger(getSupabaseServiceClient());
}
