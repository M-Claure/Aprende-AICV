/**
 * The counter seam. One interface, two implementations, same reason the `Store`
 * and `ResumeFileStore` are shaped this way: the policy and the routes must be
 * testable without a database.
 *
 * Pure module (types + an in-memory implementation): no env, no `server-only`.
 */

export interface RateLimiter {
  /**
   * Count one request against `key` and return the number of hits INSIDE the
   * current window (1 on the first request).
   *
   * Counting and reporting are one operation on purpose: a separate "read then
   * write" lets two concurrent requests both see the last free slot and both take
   * it. The Postgres implementation does it in a single statement.
   *
   * Never throws for infrastructure reasons — an unavailable counter must not take
   * the product down. It reports 0, which is below every limit, and logs.
   */
  hit(key: string, windowSeconds: number): Promise<number>;
}

/**
 * In-process counter for tests, and for `PERSISTENCE=memory`.
 *
 * NOT suitable for a deployed app: Vercel runs many instances and each would keep
 * its own count, so the effective limit is multiplied by the instance count. That
 * is precisely why the real implementation is in Postgres.
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { startedAt: number; hits: number }>();

  /** Clock injected so window expiry is testable without waiting an hour. */
  constructor(private readonly now: () => number = () => Date.now()) {}

  async hit(key: string, windowSeconds: number): Promise<number> {
    const at = this.now();
    const existing = this.windows.get(key);
    if (!existing || at - existing.startedAt >= windowSeconds * 1000) {
      this.windows.set(key, { startedAt: at, hits: 1 });
      return 1;
    }
    existing.hits += 1;
    return existing.hits;
  }

  /** Test helper: forget every counter. */
  reset(): void {
    this.windows.clear();
  }
}

/**
 * A limiter that counts nothing and always answers 0 (never over limit).
 *
 * Used when `USAGE_LIMITS=off`, and as the fail-open fallback when the counter
 * cannot be reached at all. Named for what it is, so a log line saying "no-op
 * limiter" is unambiguous rather than looking like a working limiter with a
 * suspiciously low count.
 */
export class NoopRateLimiter implements RateLimiter {
  // Parameters are declared and ignored so this is callable exactly like the real
  // limiter — a drop-in that only type-checks with no arguments would not be one.
  async hit(_key: string, _windowSeconds: number): Promise<number> {
    return 0;
  }
}
