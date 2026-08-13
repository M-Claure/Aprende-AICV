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
  buildNormalizerSystemPrompt,
  buildNormalizerUserPrompt,
  buildPlannerPrompt,
  buildProofreadPrompt,
  buildResumeGenerationPrompt,
  buildSkillSuggestionPrompt,
} from "./prompts";

/**
 * How much reasoning one operation is allowed to spend.
 *
 * `request` is spread into `messages.create`, so adding a field here changes every
 * call that uses the budget. Thinking is billed at OUTPUT rates, which is why this
 * is the main cost dial in the file.
 */
interface CallBudget {
  request: {
    thinking?: { type: "disabled" } | { type: "adaptive" };
    output_config?: { effort: "low" | "medium" | "high" };
  };
}

/**
 * `thinking` and `output_config` are absent from the installed @anthropic-ai/sdk's
 * types (0.32.1 predates both), so they ride to the API through a spread rather
 * than a typed field. The API validates them; the SDK just forwards the body.
 *
 * The hazard is that a field this old SDK cannot type is also a field the compiler
 * cannot check — so if the API ever rejects one, EVERY call would 400 and the whole
 * product would stop. This detects exactly that rejection so the call can be retried
 * without the budget: slower and dearer, but working. Upgrading the SDK makes both
 * this guard and the spread unnecessary.
 */
function rejectsBudgetFields(err: unknown): boolean {
  if (!(err instanceof Anthropic.BadRequestError)) return false;
  // Check the response body as well as the message: the SDK composes `message`
  // itself, so the offending field name may only appear in the body it embeds.
  const body = JSON.stringify((err as { error?: unknown }).error ?? "");
  return /thinking|output_config|effort/i.test(`${err.message} ${body}`);
}

/**
 * Extraction, classification and correction: read the input, fill the fields.
 * No thinking, lowest effort — there is no multi-step problem to reason through,
 * and the JSON these calls return is small and highly constrained by its schema.
 */
const MECHANICAL: CallBudget = {
  request: { thinking: { type: "disabled" }, output_config: { effort: "low" } },
};

/**
 * The résumé itself — the one output the whole product is judged on. Thinking on,
 * effort `high`.
 *
 * `medium` was tried here as a cost saving and gave visibly thinner résumés, so it
 * was reverted: this call is ~1 of 20 per résumé, and the savings were never worth
 * the quality. The savings that stuck are on the mechanical funnel calls, which
 * cannot affect prose quality (see MECHANICAL).
 */
const AUTHORED: CallBudget = {
  request: { thinking: { type: "adaptive" }, output_config: { effort: "high" } },
};

/**
 * Judgement about an already-written résumé: the critique and its follow-up
 * questions. Thinking on at `medium` — the output is bounded to five questions, and
 * this is not the text the person walks away with.
 */
const CONSIDERED: CallBudget = {
  request: { thinking: { type: "adaptive" }, output_config: { effort: "medium" } },
};

/** Ceiling a retry may grow into, and the factor it grows by per truncation. */
const MODEL_MAX_TOKENS = 32000;
const TRUNCATION_HEADROOM = 1.75;

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

  /*
   * ── Thinking and effort, per operation ──────────────────────────────────────
   *
   * Sending no `thinking` field runs ADAPTIVE thinking on current models, and
   * thinking is billed at output rates — the expensive half of the bill. Worse,
   * `thinking.display` defaults to "omitted", and nothing here ever reads a
   * thinking block, so those tokens were paid for and thrown away.
   *
   * So each operation now declares what it needs:
   *   - Mechanical extraction and correction (normalize an answer, pull interests
   *     out of a sentence, fix accents) get NO thinking and low effort. There is no
   *     multi-step reasoning in "which field does this sentence fill".
   *   - Writing and judgement (the résumé itself, the critique) keep thinking, at
   *     medium effort rather than the default high.
   *
   * `max_tokens` is sized to the JSON each call actually returns plus room for the
   * thinking the call is allowed to do — no longer a blanket ceiling, since a large
   * budget invites deeper thinking than these tasks need.
   */
  async planNextQuestion(params: PlanQuestionParams): Promise<PlannerDecision> {
    return this.callJson(buildPlannerPrompt(params), PlannerDecisionSchema, 1536, "plan-question", MECHANICAL);
  }

  async normalizeAnswer(params: NormalizeAnswerParams): Promise<AnswerNormalization> {
    /*
     * Sent as two halves: the instructions and this section's schema go in the
     * SYSTEM prompt, the question and the person's answer in the user turn.
     *
     * That ordering is what makes the instructions reusable. Prompt caching matches
     * on a prefix, and the old single-string prompt opened with the answer, so every
     * one of the ~26 normalizer calls per résumé had a unique prefix and nothing
     * could ever be reused. Now every call in a section shares a byte-identical
     * system prefix. Turning the cache ON is one `cache_control` marker away — the
     * installed SDK (0.32.1) does not type it at all, so that waits for the upgrade;
     * `[ai-usage]` already prints `cache_read` to confirm it when it lands.
     */
    return this.callJson(
      buildNormalizerUserPrompt(params),
      AnswerNormalizationSchema,
      2048,
      "normalize-answer",
      MECHANICAL,
      buildNormalizerSystemPrompt(params.section),
    );
  }

  async suggestSkills(params: SuggestSkillsParams): Promise<SuggestedSkillPayload[]> {
    return this.callJson(buildSkillSuggestionPrompt(params), z.array(SuggestedSkillSchema).max(20), 1536, "suggest-skills", MECHANICAL);
  }

  async extractInterests(params: ExtractInterestsParams): Promise<InterestsExtraction> {
    return this.callJson(buildInterestsExtractionPrompt(params), InterestsExtractionSchema, 1024, "extract-interests", MECHANICAL);
  }

  async generateResumeContent(input: ResumeGenerationInput): Promise<ResumeContent> {
    // The one call whose quality the whole product rests on: thinking stays on.
    return this.callJson(buildResumeGenerationPrompt(input), ResumeContentSchema, 16000, "generate-resume", AUTHORED);
  }

  async analyzeResume(params: AnalyzeResumeParams): Promise<ResumeAnalysisPayload> {
    return this.callJson(buildAnalysisPrompt(params), ResumeAnalysisSchema, 6000, "analyze-resume", CONSIDERED);
  }

  async proofreadResume(params: ProofreadResumeParams): Promise<ProofreadResult> {
    // Spelling, accents and punctuation over text that is already written.
    return this.callJson(buildProofreadPrompt(params), ProofreadResultSchema, 8000, "proofread-resume", MECHANICAL);
  }

  // ── internals ──
  private async callJson<S extends z.ZodTypeAny>(
    prompt: string,
    schema: S,
    maxTokens: number,
    label: string,
    budget: CallBudget,
    /**
     * Task instructions that do NOT vary with the input, appended to the factuality
     * rules as a second system block. Kept separate from `prompt` so the stable text
     * forms a prefix the API can cache once caching is enabled.
     */
    stableInstructions?: string,
  ): Promise<z.infer<S>> {
    let lastError: unknown;
    let truncations = 0;
    let budgetFields: CallBudget["request"] = budget.request;
    for (let attempt = 0; attempt < 3; attempt++) {
      const content =
        attempt === 0
          ? prompt
          : `${prompt}\n\nTu respuesta anterior no era JSON válido según el esquema. Devuelve SOLO el JSON válido.`;
      // A truncated response is not a wrong response — it is the same response with
      // no room to finish. Retrying at the SAME ceiling truncates again and bills
      // again, so each retry after a truncation gets more room instead.
      const attemptMaxTokens = Math.min(
        Math.round(maxTokens * TRUNCATION_HEADROOM ** truncations),
        MODEL_MAX_TOKENS,
      );
      let text: string;
      try {
        const res = await this.client.messages.create({
          model: this.model,
          max_tokens: attemptMaxTokens,
          // Stable text first (factuality rules, then task instructions), variable
          // input last — the order prompt caching needs.
          system: stableInstructions
            ? [
                { type: "text" as const, text: SYSTEM_FACTUALITY },
                { type: "text" as const, text: stableInstructions },
              ]
            : SYSTEM_FACTUALITY,
          messages: [{ role: "user", content }],
          ...budgetFields,
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
          truncations += 1;
          lastError = new Error(
            `Respuesta truncada por max_tokens (max_tokens=${attemptMaxTokens}); el JSON quedó incompleto.`,
          );
          // No headroom left to grant: another attempt would truncate identically.
          if (attemptMaxTokens >= MODEL_MAX_TOKENS) break;
          continue;
        }
      } catch (err) {
        // The API rejected thinking/effort: drop them and retry rather than failing
        // every call in the product. Logged loudly — it means the SDK needs updating.
        if (Object.keys(budgetFields).length > 0 && rejectsBudgetFields(err)) {
          console.error(
            `[ai] ${label}: la API rechazó thinking/output_config; reintentando sin ellos ` +
              `(costará más). Actualiza @anthropic-ai/sdk. Detalle: ${String(err)}`,
          );
          budgetFields = {};
          continue;
        }
        // A misconfiguration is not a bad model response: retrying cannot fix it,
        // and reporting it as one sends whoever debugs it looking at prompts and
        // Zod schemas instead of at the API key. Fail on the first attempt with
        // the real cause in the server log and in the error `details`.
        const misconfigured = describeConfigurationFailure(err, this.model);
        if (misconfigured) {
          console.error(`[ai] ${label}: ${misconfigured}`);
          throw Errors.serviceUnavailable(
            "No pudimos conectar con el servicio de IA. No es tu culpa: avísanos para revisarlo.",
            { label, cause: misconfigured },
          );
        }
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
 * Names the failures that come from how this server is configured rather than
 * from what the model returned — an invalid/revoked key, a key without access to
 * the configured model, a model id that does not exist. Returns null for
 * everything a retry can plausibly fix (rate limits, overloads, timeouts, 5xx).
 *
 * Kept as an explicit allow-list of statuses so a transient failure is never
 * mistaken for a permanent one and given up on.
 */
function describeConfigurationFailure(err: unknown, model: string): string | null {
  if (err instanceof Anthropic.AuthenticationError) {
    return "ANTHROPIC_API_KEY no es válida o fue revocada (401 authentication_error).";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return `La ANTHROPIC_API_KEY no tiene permiso para usar el modelo "${model}" (403 permission_error).`;
  }
  if (err instanceof Anthropic.NotFoundError) {
    return `ANTHROPIC_MODEL="${model}" no existe o no está disponible para esta cuenta (404 not_found_error).`;
  }
  return null;
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
