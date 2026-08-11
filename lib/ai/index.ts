import "server-only";
import { getEnv } from "@/lib/env";
import { AnthropicProvider } from "./anthropic-provider";
import { HybridAIProvider } from "./hybrid-provider";
import { MockAIProvider } from "./mock-provider";
import type { AIProvider } from "./provider";

export type {
  AIProvider,
  QuestionCandidate,
  PlanQuestionParams,
  NormalizeAnswerParams,
  SuggestSkillsParams,
  ResumeGenerationInput,
} from "./provider";

let cached: AIProvider | null = null;
let funnelCached: AIProvider | null = null;

/**
 * The configured AI provider (Anthropic when enabled, else mock). Used ONLY for
 * resume generation + analysis (end of funnel + each regenerate).
 */
export function getAIProvider(): AIProvider {
  if (cached) return cached;
  const env = getEnv();
  if (env.AI_PROVIDER === "anthropic") {
    cached = new AnthropicProvider(env.ANTHROPIC_API_KEY!, env.ANTHROPIC_MODEL);
  } else {
    cached = new MockAIProvider();
  }
  return cached;
}

/**
 * The FUNNEL provider used for per-step operations (answer normalization, skill
 * suggestion, next-question planning, entry enrichment).
 *
 * - AI_PROVIDER=mock  → pure deterministic mock (offline, tests, zero tokens).
 * - AI_PROVIDER=anthropic → a HybridAIProvider: Claude parses the narrative
 *   sections that most affect résumé quality (experience, projects, languages,
 *   achievements, interests) while cheap ops (planning, skill inference,
 *   simple-field normalization) stay on the mock to limit token spend.
 */
export function getFunnelProvider(): AIProvider {
  if (funnelCached) return funnelCached;
  const env = getEnv();
  funnelCached =
    env.AI_PROVIDER === "anthropic"
      ? new HybridAIProvider(
          new AnthropicProvider(env.ANTHROPIC_API_KEY!, env.ANTHROPIC_MODEL),
          new MockAIProvider(),
        )
      : new MockAIProvider();
  return funnelCached;
}

/** Test hook to inject a provider. */
export function __setAIProvider(provider: AIProvider | null): void {
  cached = provider;
}
