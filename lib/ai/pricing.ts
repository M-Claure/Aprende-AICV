/**
 * Token pricing used ONLY to print rough cost estimates in the server logs
 * alongside real token counts (see AzureOpenAIProvider). Rates are USD per
 * 1,000,000 tokens.
 *
 * ⚠️ These are best-effort defaults — VERIFY them against your own agreement at
 * https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/
 * (or Azure Portal → Cost Management). Azure's billing is the source of truth for
 * actual cost; the numbers here just help you attribute that cost to specific
 * operations.
 *
 * Note there is no separate cache-WRITE rate on this platform: caching is
 * automatic and writing to the cache costs the normal input rate. Only cache
 * READS are discounted.
 */
export interface ModelRates {
  /** USD per 1M input tokens. */
  inputPerMTok: number;
  /** USD per 1M output tokens (reasoning tokens bill at this rate too). */
  outputPerMTok: number;
  /** USD per 1M tokens read from the prompt cache (defaults to input rate). */
  cacheReadPerMTok?: number;
}

/** Keyed by model/deployment-id prefix. Update to match your agreement. */
const RATES: Record<string, ModelRates> = {
  "gpt-5.3-codex": { inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0.125 },
  "gpt-5.1-codex": { inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0.125 },
  "gpt-5-codex": { inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0.125 },
  "gpt-5-mini": { inputPerMTok: 0.25, outputPerMTok: 2, cacheReadPerMTok: 0.025 },
  "gpt-5-nano": { inputPerMTok: 0.05, outputPerMTok: 0.4, cacheReadPerMTok: 0.005 },
  // Keep AFTER the more specific gpt-5-* prefixes above: `findRates` matches on
  // the first prefix that fits, and "gpt-5" is a prefix of all of them.
  "gpt-5": { inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0.125 },
};

function findRates(model: string): ModelRates | null {
  for (const [prefix, rates] of Object.entries(RATES)) {
    if (model.startsWith(prefix)) return rates;
  }
  return null;
}

/**
 * The token-usage shape the Responses API returns. Cached input and reasoning
 * output arrive nested, unlike the flat counters the Messages API used.
 */
export interface UsageTokens {
  input_tokens?: number | null;
  output_tokens?: number | null;
  input_tokens_details?: { cached_tokens?: number | null } | null;
  output_tokens_details?: { reasoning_tokens?: number | null } | null;
}

/**
 * Estimated USD cost for one API response. Returns null if the model has no
 * configured rates (so callers can print "rates not set" instead of a wrong $0).
 */
export function estimateCostUsd(model: string, u: UsageTokens): number | null {
  const rates = findRates(model);
  if (!rates) return null;
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const cacheRead = u.input_tokens_details?.cached_tokens ?? 0;
  /*
   * `input_tokens` is the TOTAL, cached tokens included — so the cached portion is
   * billed at the discounted rate and only the remainder at full rate. Adding the
   * two counts instead would bill the cached tokens twice.
   */
  const fullPriceInput = Math.max(0, input - cacheRead);
  return (
    (fullPriceInput * rates.inputPerMTok +
      // Reasoning tokens are already included in `output_tokens`.
      output * rates.outputPerMTok +
      cacheRead * (rates.cacheReadPerMTok ?? rates.inputPerMTok)) /
    1_000_000
  );
}
