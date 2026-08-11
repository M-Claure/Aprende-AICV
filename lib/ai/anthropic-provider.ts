import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { Errors } from "@/lib/errors";
import { estimateCostUsd, type UsageTokens } from "./pricing";
import type {
  AIProvider,
  AnalyzeResumeParams,
  ExtractInterestsParams,
  NormalizeAnswerParams,
  PlanQuestionParams,
  ProofreadResumeParams,
  ResumeGenerationInput,
  SuggestSkillsParams,
} from "./provider";
import {
  AnswerNormalizationSchema,
  InterestsExtractionSchema,
  PlannerDecisionSchema,
  ProofreadResultSchema,
  ResumeAnalysisSchema,
  ResumeContentSchema,
  SuggestedSkillSchema,
  type AnswerNormalization,
  type InterestsExtraction,
  type PlannerDecision,
  type ProofreadResult,
  type ResumeAnalysisPayload,
  type ResumeContent,
  type SuggestedSkillPayload,
} from "./schemas";
import {
  SYSTEM_FACTUALITY,
  buildAnalysisPrompt,
  buildInterestsExtractionPrompt,
  buildNormalizerPrompt,
  buildPlannerPrompt,
  buildProofreadPrompt,
  buildResumeGenerationPrompt,
  buildSkillSuggestionPrompt,
} from "./prompts";

/**
 * Real Claude-backed provider. Every call:
 *  1. sends the factuality system prompt + a task prompt,
 *  2. extracts JSON from the response,
 *  3. validates against the task's Zod schema (retrying once on failure),
 *  4. throws an ai_validation_error if the model still won't conform.
 *
 * The model is never given database access or tools that mutate state.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  // Funnel calls: max_tokens leaves generous headroom because newer Claude models
  // spend part of the budget on a `thinking` block before the JSON.
  async planNextQuestion(params: PlanQuestionParams): Promise<PlannerDecision> {
    return this.callJson(buildPlannerPrompt(params), PlannerDecisionSchema, 3072, "plan-question");
  }

  async normalizeAnswer(params: NormalizeAnswerParams): Promise<AnswerNormalization> {
    return this.callJson(buildNormalizerPrompt(params), AnswerNormalizationSchema, 4096, "normalize-answer");
  }

  async suggestSkills(params: SuggestSkillsParams): Promise<SuggestedSkillPayload[]> {
    return this.callJson(buildSkillSuggestionPrompt(params), z.array(SuggestedSkillSchema).max(20), 3072, "suggest-skills");
  }

  async extractInterests(params: ExtractInterestsParams): Promise<InterestsExtraction> {
    return this.callJson(buildInterestsExtractionPrompt(params), InterestsExtractionSchema, 2048, "extract-interests");
  }

  async generateResumeContent(input: ResumeGenerationInput): Promise<ResumeContent> {
    // Headroom: newer Claude models spend part of max_tokens on a `thinking`
    // block, so the JSON résumé needs a generous ceiling to avoid truncation.
    return this.callJson(buildResumeGenerationPrompt(input), ResumeContentSchema, 16000, "generate-resume");
  }

  async analyzeResume(params: AnalyzeResumeParams): Promise<ResumeAnalysisPayload> {
    return this.callJson(buildAnalysisPrompt(params), ResumeAnalysisSchema, 8000, "analyze-resume");
  }

  async proofreadResume(params: ProofreadResumeParams): Promise<ProofreadResult> {
    return this.callJson(buildProofreadPrompt(params), ProofreadResultSchema, 12000, "proofread-resume");
  }

  // ── internals ──
  private async callJson<S extends z.ZodTypeAny>(
    prompt: string,
    schema: S,
    maxTokens: number,
    label: string,
  ): Promise<z.infer<S>> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const content =
        attempt === 0
          ? prompt
          : `${prompt}\n\nTu respuesta anterior no era JSON válido según el esquema. Devuelve SOLO el JSON válido.`;
      let text: string;
      try {
        const res = await this.client.messages.create({
          model: this.model,
          max_tokens: maxTokens,
          system: SYSTEM_FACTUALITY,
          messages: [{ role: "user", content }],
        });
        // Log real token usage + estimated cost for every call (even truncated
        // retries, which still bill). This is what makes per-generation cost
        // visible in the server logs.
        logUsage(label, this.model, res.usage, attempt);
        text = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        // Truncation → the JSON is incomplete and will never parse. Surface a
        // clear cause in the error details (visible in the API error envelope)
        // and let the retry loop try again with more room to finish.
        if (res.stop_reason === "max_tokens") {
          lastError = new Error(
            `Respuesta truncada por max_tokens (max_tokens=${maxTokens}); el JSON quedó incompleto.`,
          );
          continue;
        }
      } catch (err) {
        lastError = err;
        continue;
      }
      const parsed = tryParseJson(text);
      if (parsed === undefined) {
        lastError = new Error("Model did not return JSON");
        continue;
      }
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;
      lastError = result.error;
    }
    throw Errors.aiValidation("La IA no devolvió una respuesta válida.", String(lastError));
  }
}

/**
 * Per-process running total, so the cost of a whole résumé-builder session
 * (many calls) accumulates in the logs, not just per call.
 */
const usageTotals = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };

/** Log one API response's token usage + estimated cost with a running total. */
function logUsage(
  label: string,
  model: string,
  usage: UsageTokens | undefined,
  attempt: number,
): void {
  if (!usage) return;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cost = estimateCostUsd(model, usage);

  usageTotals.calls += 1;
  usageTotals.inputTokens += input;
  usageTotals.outputTokens += output;
  if (cost != null) usageTotals.costUsd += cost;

  const costStr = cost != null ? `≈$${cost.toFixed(4)} (estimado)` : "(configura tarifas en lib/ai/pricing.ts)";
  const retry = attempt > 0 ? ` retry#${attempt}` : "";
  const total =
    `total sesión: ${usageTotals.calls} llamadas, ` +
    `in=${usageTotals.inputTokens} out=${usageTotals.outputTokens} ` +
    `costo≈$${usageTotals.costUsd.toFixed(4)}`;
  console.log(
    `[ai-usage] ${label}${retry} model=${model} in=${input} out=${output} ` +
      `cache_read=${cacheRead} costo=${costStr} | ${total}`,
  );
}

/** Extract a JSON value from model text, tolerating markdown fences / prose. */
function tryParseJson(text: string): unknown {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const candidates = [cleaned];
  const firstBrace = cleaned.search(/[[{]/);
  const lastBrace = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // try next candidate
    }
  }
  return undefined;
}
