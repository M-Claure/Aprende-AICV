/**
 * Request limits: the keying, the window, and the numbers themselves.
 *
 * Why this matters beyond "the counter increments": the product has no login, so an
 * unauthenticated script can mint unlimited identities and drive the paid routes.
 * The keying decisions below are what make a limit meaningful — a limit on the wrong
 * key is a limit that does nothing.
 */
import { describe, expect, it } from "vitest";
import {
  LIMITS,
  clientIp,
  isOverLimit,
  rateLimitKey,
  type LimitedOperation,
} from "@/lib/rate-limit/policy";
import { MemoryRateLimiter, NoopRateLimiter } from "@/lib/rate-limit/rate-limiter";

describe("keying", () => {
  it("keys by user when there is one, so a shared IP is not a shared quota", () => {
    const key = rateLimitKey("generate", { userId: "u1", ip: "203.0.113.7" });
    expect(key).toBe("user:u1:generate");
  });

  it("keys by IP only when there is no user yet", () => {
    // `profile_create` runs before an identity exists — that is the whole reason
    // this branch exists.
    expect(rateLimitKey("profile_create", { ip: "203.0.113.7" })).toBe(
      "ip:203.0.113.7:profile_create",
    );
  });

  it("still counts when the address is unknown, rather than skipping the limit", () => {
    // A proxy that strips the client address must not become a way to opt out.
    expect(rateLimitKey("profile_create", {})).toBe("ip:unknown:profile_create");
    expect(rateLimitKey("profile_create", { ip: "" })).toBe("ip:unknown:profile_create");
  });

  it("separates operations, so answering questions cannot exhaust generation", () => {
    expect(rateLimitKey("answer", { userId: "u1" })).not.toBe(
      rateLimitKey("generate", { userId: "u1" }),
    );
  });
});

describe("clientIp", () => {
  it("takes the LEFTMOST x-forwarded-for entry — the original client", () => {
    // Every proxy appends itself, so the rightmost is the edge. Keying on that
    // would put the whole internet in one bucket.
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" });
    expect(clientIp(headers)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to null", () => {
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers())).toBeNull();
  });
});

describe("limits", () => {
  it("is over only ABOVE the allowance, so the last permitted request goes through", () => {
    const { limit } = LIMITS.generate;
    expect(isOverLimit("generate", limit)).toBe(false);
    expect(isOverLimit("generate", limit + 1)).toBe(true);
  });

  it("lets a complete résumé through — four generations plus retries", () => {
    // MAX_RESUME_ITERATIONS is 3, so a finished résumé needs 4 generations. A limit
    // at or below that would block the product itself.
    expect(LIMITS.generate.limit).toBeGreaterThan(4);
  });

  it("gives every operation a documented, positive, hour-scale window", () => {
    for (const [operation, rule] of Object.entries(LIMITS)) {
      expect(rule.limit, operation).toBeGreaterThan(0);
      expect(rule.windowSeconds, operation).toBeGreaterThan(0);
      // The reason is the part a future reader needs before changing the number.
      expect(rule.reason.length, operation).toBeGreaterThan(40);
    }
  });
});

describe("MemoryRateLimiter", () => {
  it("counts within a window and resets after it", async () => {
    let now = 1_000_000;
    const limiter = new MemoryRateLimiter(() => now);

    expect(await limiter.hit("k", 60)).toBe(1);
    expect(await limiter.hit("k", 60)).toBe(2);

    now += 59_000; // still inside the window
    expect(await limiter.hit("k", 60)).toBe(3);

    now += 2_000; // window elapsed
    expect(await limiter.hit("k", 60)).toBe(1);
  });

  it("counts each key independently", async () => {
    const limiter = new MemoryRateLimiter();
    await limiter.hit("a", 60);
    await limiter.hit("a", 60);
    expect(await limiter.hit("b", 60)).toBe(1);
  });
});

describe("NoopRateLimiter", () => {
  it("reports a count below every limit", async () => {
    const limiter = new NoopRateLimiter();
    const hits = await limiter.hit("k", 60);
    for (const operation of Object.keys(LIMITS) as LimitedOperation[]) {
      expect(isOverLimit(operation, hits), operation).toBe(false);
    }
  });
});
