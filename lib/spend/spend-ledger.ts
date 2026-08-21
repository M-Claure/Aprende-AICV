/**
 * The spend ledger seam: record what a model call cost, and read back the totals
 * a budget decision needs.
 *
 * Pure module (types + an in-memory implementation), so `checkBudget` and the
 * route guards are testable without a database.
 */
import type { SpendState } from "./budget";

/** One model call, as the provider saw it. */
export interface SpendEntry {
  readonly userId: string | null;
  /** Null for calls not attached to one résumé (rare — only the funnel planner). */
  readonly resumeProfileId: string | null;
  readonly operation: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  /** Estimated USD — the same number `[ai-usage]` prints. */
  readonly usdEstimate: number;
}

export interface SpendLedger {
  /**
   * Append one call.
   *
   * Fire-and-forget by contract: never throws, and callers do not await it on the
   * response path. A dropped ledger row must not fail a résumé the user already
   * paid for — the row is bookkeeping, the résumé is the product.
   */
  record(entry: SpendEntry): Promise<void>;

  /**
   * Totals for a budget decision: this résumé, this user, today.
   *
   * Returns zeros when the ledger is unreachable, which means "allow" — see the
   * fail-open note in `SupabaseSpendLedger`.
   */
  state(userId: string | null, resumeProfileId: string | null): Promise<SpendState>;
}

const ZERO: SpendState = { profileUsd: 0, userUsd: 0, globalDayUsd: 0 };

/** In-process ledger for tests and `PERSISTENCE=memory`. */
export class MemorySpendLedger implements SpendLedger {
  private readonly entries: (SpendEntry & { at: number })[] = [];

  constructor(private readonly now: () => number = () => Date.now()) {}

  async record(entry: SpendEntry): Promise<void> {
    this.entries.push({ ...entry, at: this.now() });
  }

  async state(userId: string | null, resumeProfileId: string | null): Promise<SpendState> {
    // Same UTC day boundary the SQL uses, so the two implementations agree.
    const startOfDay = new Date(this.now());
    startOfDay.setUTCHours(0, 0, 0, 0);
    const dayStart = startOfDay.getTime();

    const sum = (rows: (SpendEntry & { at: number })[]) =>
      rows.reduce((total, e) => total + e.usdEstimate, 0);

    return {
      profileUsd: resumeProfileId
        ? sum(this.entries.filter((e) => e.resumeProfileId === resumeProfileId))
        : 0,
      userUsd: userId ? sum(this.entries.filter((e) => e.userId === userId)) : 0,
      globalDayUsd: sum(this.entries.filter((e) => e.at >= dayStart)),
    };
  }

  /** Test helper. */
  reset(): void {
    this.entries.length = 0;
  }
}

/**
 * A ledger that records nothing and reports zero spend.
 *
 * Used when `USAGE_LIMITS=off` and as the fail-open fallback when no service-role
 * key is configured. Zero spend means every cap check passes, which is the same
 * "do not take the product down over configuration" choice the limiter makes.
 */
export class NoopSpendLedger implements SpendLedger {
  // Declared-and-ignored parameters, so this is callable exactly like the real
  // ledger rather than only where no arguments are passed.
  async record(_entry: SpendEntry): Promise<void> {}
  async state(_userId: string | null, _resumeProfileId: string | null): Promise<SpendState> {
    return ZERO;
  }
}

export { ZERO as ZERO_SPEND };
