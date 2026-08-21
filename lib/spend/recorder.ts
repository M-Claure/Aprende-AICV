import type { CallSpendRecorder } from "@/lib/ai/azure-openai-provider";
import { estimateCostUsdForCap } from "@/lib/ai/pricing";
import type { SpendLedger } from "./spend-ledger";

/**
 * Bind a ledger to one request's user and résumé, producing the sink the provider
 * calls after every model response.
 *
 * This is the piece that turns "cost printed in a log line" into "cost the caps can
 * see". It lives here rather than in `getRequestContext` so the mapping from the
 * provider's raw `usage` block to a ledger row has one home, and rather than inside
 * the provider so the provider keeps no knowledge of the database.
 *
 * **Never awaited on the response path.** A résumé the user already paid for must
 * not fail because bookkeeping was slow, so the write is fired and forgotten; the
 * risk accepted in exchange is that a serverless instance frozen immediately after
 * responding can drop the last row. Undercounting by one call is the right side of
 * that trade — the alternative charges every user latency on every model call.
 *
 * The label the provider passes (`generate_resume`, `normalize_answer`, …) becomes
 * `ai_spend.operation`, which is what makes a cost breakdown per operation possible
 * later without another schema change.
 */
export function createCallSpendRecorder(input: {
  ledger: SpendLedger;
  userId: string;
  /** Null for a call not attached to one résumé. */
  resumeProfileId: string | null;
}): CallSpendRecorder {
  return (label, model, usage) => {
    if (!usage) return;
    void input.ledger
      .record({
        userId: input.userId,
        resumeProfileId: input.resumeProfileId,
        operation: label,
        model,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        // `input_tokens` already includes the cached portion; recorded separately so
        // a cache that stops landing is visible as cost rising with tokens flat.
        cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
        // Not `estimateCostUsd`: an unpriced model must not record $0 and quietly
        // make every ceiling unreachable. See `estimateCostUsdForCap`.
        usdEstimate: estimateCostUsdForCap(model, usage),
      })
      .catch((err) => {
        // `record` is contractually non-throwing; this is belt-and-braces so a
        // future implementation cannot turn bookkeeping into an unhandled rejection.
        console.error("[spend] recorder threw:", err);
      });
  };
}
