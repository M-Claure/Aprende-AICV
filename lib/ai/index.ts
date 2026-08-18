import "server-only";
import { getEnv } from "@/lib/env";
import { AzureOpenAIProvider } from "./azure-openai-provider";
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
 * The configured AI provider (Azure OpenAI when enabled, else mock). Used ONLY for
 * resume generation + analysis (end of funnel + each regenerate).
 */
export function getAIProvider(): AIProvider {
  if (cached) return cached;
  const env = getEnv();
  if (env.AI_PROVIDER === "azure") {
    cached = new AzureOpenAIProvider(
      env.AZURE_OPENAI_API_KEY!,
      env.AZURE_OPENAI_BASE_URL!,
      env.AZURE_OPENAI_MODEL,
    );
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
 * - AI_PROVIDER=azure → a HybridAIProvider: the model parses the narrative
 *   sections that most affect résumé quality (experience, projects, languages,
 *   achievements, interests) while cheap ops (planning, skill inference,
 *   simple-field normalization) stay on the mock to limit token spend.
 */
export function getFunnelProvider(): AIProvider {
  if (funnelCached) return funnelCached;
  const env = getEnv();
  funnelCached =
    env.AI_PROVIDER === "azure"
      ? new HybridAIProvider(
          new AzureOpenAIProvider(
            env.AZURE_OPENAI_API_KEY!,
            env.AZURE_OPENAI_BASE_URL!,
            env.AZURE_OPENAI_MODEL,
          ),
          new MockAIProvider(),
        )
      : new MockAIProvider();
  return funnelCached;
}

/** Test hook to inject a provider. */
export function __setAIProvider(provider: AIProvider | null): void {
  cached = provider;
}
