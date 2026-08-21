import "server-only";
import type { AIProvider } from "@/lib/ai";
import { getDeterministicProvider } from "@/lib/ai";
import { Errors } from "@/lib/errors";
import {
  LIMITS,
  getRateLimiter,
  isOverLimit,
  rateLimitKey,
  type LimitedOperation,
} from "@/lib/rate-limit";
import type { Store } from "@/lib/repositories";
import {
  checkBudget,
  describeRefusal,
  getSpendCaps,
  getSpendLedger,
  type PaidOperation,
} from "@/lib/spend";

/**
 * The two guards a route puts in front of expensive work.
 *
 * ── Why routes call these explicitly ─────────────────────────────────────────
 * It would be tidier to hide this inside `handleRoute` or `getRequestContext`, and
 * wrong: neither knows WHICH operation is being performed, and the operation is the
 * whole input to the decision. An explicit line at the top of a route is also
 * greppable — `grep -rn enforceRateLimit app/api` answers "what is protected?",
 * which a decorator cannot.
 *
 * ── Blocking versus degrading ────────────────────────────────────────────────
 * Being over budget must not strand someone mid-résumé, so the two paths differ:
 *
 *   - CAPTURE (answers, interests, enrichment) DEGRADES. `funnelProviderForBudget`
 *     hands back the deterministic provider, so the question is still answered, the
 *     person's raw words are still stored verbatim, and the funnel still advances —
 *     with zero model calls. What is lost is model-quality parsing of that one
 *     answer, and `rawDescription` keeps the original text for generation later.
 *   - PRODUCTION (generate, analyze, proofread, regenerate) BLOCKS, because there is
 *     no cheap version of writing a résumé. A deterministic "résumé" would be a
 *     worse outcome than being asked to come back later.
 *
 * Rate limits always block: exceeding one is a claim about intent, not about cost,
 * and the numbers are set high enough that a person does not reach them.
 */

/**
 * Count this request and refuse it if the caller is over the operation's allowance.
 *
 * @throws AppError 429 (`rate_limited`)
 */
export async function enforceRateLimit(
  operation: LimitedOperation,
  subject: { userId?: string | null; ip?: string | null },
): Promise<void> {
  const rule = LIMITS[operation];
  const key = rateLimitKey(operation, subject);
  const hits = await getRateLimiter().hit(key, rule.windowSeconds);
  if (isOverLimit(operation, hits)) {
    // The key is logged, not the limit's reasoning: this line is for spotting a
    // flood, and the key is what an operator needs to see repeated.
    console.warn(`[rate-limit] ${key} blocked at ${hits} hits (limit ${rule.limit}/${rule.windowSeconds}s)`);
    throw Errors.rateLimited();
  }
}

/**
 * Refuse a paid model call when a spend ceiling is reached.
 *
 * @throws AppError 429 (`budget_exhausted`)
 */
export async function assertWithinBudget(input: {
  operation: PaidOperation;
  userId: string;
  resumeProfileId: string;
  store: Store;
}): Promise<void> {
  const state = await getSpendLedger().state(input.userId, input.resumeProfileId);
  const verdict = checkBudget({
    operation: input.operation,
    state,
    caps: getSpendCaps(),
    // Only `generate` can be a first résumé, and only then is the extra read worth
    // it. See the exemption's reasoning in `lib/spend/budget.ts`.
    isFirstResume:
      input.operation === "generate"
        ? (await input.store.getLatestGeneratedResume(input.resumeProfileId)) === null
        : false,
  });

  if (!verdict.allowed) {
    // Amounts stay server-side: the user gets "come back later", the operator gets
    // the number and the name of the variable to raise.
    console.warn(`[spend] ${describeRefusal(input.operation, verdict)}`);
    throw Errors.budgetExhausted();
  }
}

/**
 * The provider a CAPTURE step should use: the configured funnel provider normally,
 * the deterministic one when the budget is spent.
 *
 * Returns a provider instead of throwing because the funnel is where a person is
 * doing the work. Blocking here would lose the answer they just typed to a limit
 * they cannot see, cannot influence, and did not cause.
 */
export async function funnelProviderForBudget(input: {
  funnelAi: AIProvider;
  userId: string;
  resumeProfileId: string;
}): Promise<AIProvider> {
  const state = await getSpendLedger().state(input.userId, input.resumeProfileId);
  const verdict = checkBudget({
    operation: "assist",
    state,
    caps: getSpendCaps(),
    isFirstResume: false,
  });
  if (verdict.allowed) return input.funnelAi;

  console.warn(
    `[spend] ${describeRefusal("assist", verdict)} — capture continues on the deterministic provider`,
  );
  return getDeterministicProvider();
}
