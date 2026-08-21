/**
 * Spend caps: the three ceilings, and the one exemption.
 *
 * Rate limits bound how often someone asks; these bound what the asking costs. Both
 * are needed — an attacker who stays under every request limit still spends money,
 * and with no login the cheap move is many identities rather than many requests,
 * which only the daily ceiling can see.
 */
import { describe, expect, it } from "vitest";
import { checkBudget, describeRefusal, type SpendCaps, type SpendState } from "@/lib/spend/budget";
import { estimateCostUsd, estimateCostUsdForCap } from "@/lib/ai/pricing";
import { MemorySpendLedger, NoopSpendLedger } from "@/lib/spend/spend-ledger";

const CAPS: SpendCaps = { profileUsd: 1, userUsd: 2, dailyUsd: 50 };

const spent = (over: Partial<SpendState> = {}): SpendState => ({
  profileUsd: 0,
  userUsd: 0,
  globalDayUsd: 0,
  ...over,
});

describe("checkBudget", () => {
  it("allows a call when nothing has been spent", () => {
    const v = checkBudget({
      operation: "generate",
      state: spent(),
      caps: CAPS,
      isFirstResume: false,
    });
    expect(v.allowed).toBe(true);
  });

  it("refuses once this résumé has used its allowance", () => {
    const v = checkBudget({
      operation: "analyze",
      state: spent({ profileUsd: 1.2 }),
      caps: CAPS,
      isFirstResume: false,
    });
    expect(v).toMatchObject({ allowed: false, cap: "profile", capUsd: 1 });
  });

  it("refuses once this user has used their allowance across résumés", () => {
    // Per-résumé is still clear; the user is not. This is the ceiling that catches
    // one identity spreading the same spend over several profiles.
    const v = checkBudget({
      operation: "generate",
      state: spent({ profileUsd: 0.1, userUsd: 2 }),
      caps: CAPS,
      isFirstResume: false,
    });
    expect(v).toMatchObject({ allowed: false, cap: "user" });
  });

  it("refuses everyone once the day's total is reached", () => {
    const v = checkBudget({
      operation: "generate",
      state: spent({ globalDayUsd: 50 }),
      caps: CAPS,
      isFirstResume: false,
    });
    expect(v).toMatchObject({ allowed: false, cap: "daily" });
  });

  it("reports the DAILY cap first — it is the one an operator must act on", () => {
    const v = checkBudget({
      operation: "generate",
      state: spent({ profileUsd: 99, userUsd: 99, globalDayUsd: 99 }),
      caps: CAPS,
      isFirstResume: false,
    });
    // All three are blown; naming the profile cap would send the operator to raise
    // the wrong variable.
    expect(v).toMatchObject({ allowed: false, cap: "daily" });
  });

  describe("the first-résumé exemption", () => {
    it("never refuses a profile its FIRST generation", () => {
      // The whole product is the first PDF. Refusing to produce it is worse for the
      // person than refusing to improve it, so a tight per-résumé cap must not.
      const v = checkBudget({
        operation: "generate",
        state: spent({ profileUsd: 5, userUsd: 5 }),
        caps: CAPS,
        isFirstResume: true,
      });
      expect(v.allowed).toBe(true);
    });

    it("does not extend to the improvement loop", () => {
      // `isFirstResume` can still be true for an analyze call that runs before any
      // generation; only generation is exempt.
      const v = checkBudget({
        operation: "analyze",
        state: spent({ profileUsd: 5 }),
        caps: CAPS,
        isFirstResume: true,
      });
      expect(v).toMatchObject({ allowed: false, cap: "profile" });
    });

    it("does NOT survive the daily cap", () => {
      // A flood of fresh guests makes every request somebody's first, so exempting
      // first generations from the daily ceiling would exempt the attack itself.
      const v = checkBudget({
        operation: "generate",
        state: spent({ globalDayUsd: 60 }),
        caps: CAPS,
        isFirstResume: true,
      });
      expect(v).toMatchObject({ allowed: false, cap: "daily" });
    });
  });
});

describe("describeRefusal", () => {
  it("names the env var an operator would raise, and keeps money out of the client", () => {
    const v = checkBudget({
      operation: "generate",
      state: spent({ profileUsd: 1.5 }),
      caps: CAPS,
      isFirstResume: false,
    });
    const line = describeRefusal("generate", v);
    expect(line).toContain("AI_SPEND_CAP_PROFILE_USD");
    expect(line).toContain("1.5000");
  });
});

describe("MemorySpendLedger", () => {
  it("totals by résumé, by user, and by UTC day", async () => {
    const now = Date.UTC(2026, 7, 21, 12, 0, 0);
    const ledger = new MemorySpendLedger(() => now);
    const call = (over: Partial<Parameters<typeof ledger.record>[0]>) =>
      ledger.record({
        userId: "u1",
        resumeProfileId: "p1",
        operation: "generate_resume",
        model: "gpt-5.3-codex",
        inputTokens: 100,
        outputTokens: 200,
        cachedTokens: 0,
        usdEstimate: 0.25,
        ...over,
      });

    await call({});
    await call({ resumeProfileId: "p2" }); // same user, different résumé
    await call({ userId: "u2", resumeProfileId: "p3" }); // someone else entirely

    const state = await ledger.state("u1", "p1");
    expect(state.profileUsd).toBeCloseTo(0.25);
    expect(state.userUsd).toBeCloseTo(0.5);
    // The day total is everyone's — that is what makes it a global ceiling.
    expect(state.globalDayUsd).toBeCloseTo(0.75);
  });

  it("drops yesterday's spend from the daily total", async () => {
    let now = Date.UTC(2026, 7, 20, 23, 59, 0);
    const ledger = new MemorySpendLedger(() => now);
    await ledger.record({
      userId: "u1",
      resumeProfileId: "p1",
      operation: "generate_resume",
      model: "m",
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      usdEstimate: 40,
    });

    now = Date.UTC(2026, 7, 21, 0, 1, 0); // just past midnight UTC
    const state = await ledger.state("u1", "p1");
    expect(state.globalDayUsd).toBe(0);
    // Lifetime totals do not reset with the day.
    expect(state.profileUsd).toBe(40);
  });
});

describe("NoopSpendLedger", () => {
  it("reports zero spend, which allows every call", async () => {
    // This is the fail-open path: no service-role key, or USAGE_LIMITS=off. A
    // configuration gap must not take the product down.
    const state = await new NoopSpendLedger().state("u1", "p1");
    const v = checkBudget({ operation: "generate", state, caps: CAPS, isFirstResume: false });
    expect(v.allowed).toBe(true);
  });
});

describe("estimateCostUsdForCap", () => {
  const usage = {
    input_tokens: 10_000,
    output_tokens: 5_000,
    input_tokens_details: { cached_tokens: 0 },
  };

  it("agrees with the logged estimate for a priced model", () => {
    // The cap must be enforced against the same number `[ai-usage]` prints, or an
    // operator reading the logs cannot predict when it will trip.
    expect(estimateCostUsdForCap("gpt-5.3-codex", usage)).toBeCloseTo(
      estimateCostUsd("gpt-5.3-codex", usage)!,
    );
  });

  it("charges an UNPRICED model at the most expensive known rate, never zero", () => {
    /*
     * The logger prints "configura tarifas" for an unknown model, which is fine for
     * a log line and fatal for a cap: treating null as $0 would mean swapping in a
     * model nobody added rates for silently makes every ceiling unreachable — the
     * exact drift a cap exists to catch. So it errs toward refusing work.
     */
    expect(estimateCostUsd("some-unlisted-model", usage)).toBeNull();
    const conservative = estimateCostUsdForCap("some-unlisted-model", usage);
    expect(conservative).toBeGreaterThan(0);
    expect(conservative).toBeGreaterThanOrEqual(estimateCostUsd("gpt-5-mini", usage)!);
  });
});
