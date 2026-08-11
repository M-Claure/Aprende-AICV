/**
 * Token pricing used ONLY to print rough cost estimates in the server logs
 * alongside real token counts (see AnthropicProvider). Rates are USD per
 * 1,000,000 tokens.
 *
 * ⚠️ These are best-effort defaults — VERIFY them against your plan at
 * https://www.anthropic.com/pricing (or your Anthropic console → Billing).
 * Your Anthropic dashboard is the source of truth for actual billed cost; the
 * numbers here just help you attribute that cost to specific operations.
 */
export interface ModelRates {
  /** USD per 1M input tokens. */
  inputPerMTok: number;
  /** USD per 1M output tokens. */
  outputPerMTok: number;
  /** USD per 1M tokens written to the prompt cache (defaults to input rate). */
  cacheWritePerMTok?: number;
  /** USD per 1M tokens read from the prompt cache (defaults to input rate). */
  cacheReadPerMTok?: number;
}

/** Keyed by model-id prefix. Update to match your plan. */
const RATES: Record<string, ModelRates> = {
  "claude-sonnet-5": { inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  "claude-opus-4-8": { inputPerMTok: 15, outputPerMTok: 75, cacheWritePerMTok: 18.75, cacheReadPerMTok: 1.5 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1 },
};

function findRates(model: string): ModelRates | null {
  for (const [prefix, rates] of Object.entries(RATES)) {
    if (model.startsWith(prefix)) return rates;
  }
  return null;
}

export interface UsageTokens {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
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
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  return (
    (input * rates.inputPerMTok +
      output * rates.outputPerMTok +
      cacheWrite * (rates.cacheWritePerMTok ?? rates.inputPerMTok) +
      cacheRead * (rates.cacheReadPerMTok ?? rates.inputPerMTok)) /
    1_000_000
  );
}
