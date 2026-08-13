/**
 * Cost controls, pinned as behaviour rather than intentions.
 *
 * Two things drive cost per résumé: how many calls reach Claude, and how many
 * output tokens each one spends (thinking is billed at output rates). Both are easy
 * to regress silently — a new question added to a rich section quietly becomes a
 * paid call, and a dropped budget quietly turns thinking back on everywhere.
 */
import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "@/lib/ai/anthropic-provider";
import { HybridAIProvider } from "@/lib/ai/hybrid-provider";
import { buildNormalizerSystemPrompt, buildNormalizerUserPrompt } from "@/lib/ai/prompts";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { computeCompleteness } from "@/lib/question-engine/completeness-engine";
import { completenessInput, experienceState, personalState } from "../helpers/factories";
import type { NormalizeAnswerParams } from "@/lib/ai/provider";
import type { ResumeProfileState } from "@/types";

function state(): ResumeProfileState {
  const base = completenessInput({
    careerGoal: "Recepcionista",
    personalInformation: personalState({ firstName: "Ana", hasEmail: true }),
    experience: [experienceState({ rawDescription: "Atendía clientes" })],
  });
  return { ...base, completeness: computeCompleteness(base) };
}

const params = (questionId: string, section: NormalizeAnswerParams["section"], rawAnswer = "algo"): NormalizeAnswerParams => ({
  section,
  questionId,
  questionText: "…",
  rawAnswer,
  state: state(),
});

/** Captures the request body each operation sends. */
function capturing() {
  const provider = new AnthropicProvider("sk-ant-test", "claude-sonnet-5");
  const create = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "{}" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 5 },
  });
  (provider as unknown as { client: { messages: { create: unknown } } }).client = {
    messages: { create },
  };
  return { provider, create };
}

const bodyOf = (create: ReturnType<typeof vi.fn>) => create.mock.calls[0]![0] as Record<string, unknown>;

describe("which answers are worth paying Claude for", () => {
  /** Records which side of the hybrid split each answer lands on. */
  function routed() {
    const deterministic = new MockAIProvider();
    const capable = new MockAIProvider();
    const capableCalls: string[] = [];
    vi.spyOn(capable, "normalizeAnswer").mockImplementation((p) => {
      capableCalls.push(p.questionId);
      return deterministic.normalizeAnswer(p);
    });
    return { provider: new HybridAIProvider(capable, deterministic), capableCalls };
  }

  it("sends narrative experience answers to Claude", async () => {
    const { provider, capableCalls } = routed();
    await provider.normalizeAnswer(params("experience_add", "experience", "Ayudaba en el negocio de mi mamá"));
    await provider.normalizeAnswer(params("experience_daily_tasks", "experience", "Contestaba llamadas"));
    await provider.normalizeAnswer(params("experience_results", "experience", "Atendí como 20 clientes al día"));
    expect(capableCalls).toEqual(["experience_add", "experience_daily_tasks", "experience_results"]);
  });

  it("sends education narratives to Claude, but not education dates", async () => {
    // One answer holds a level, a school and a subject; the deterministic parser
    // dumped the whole sentence into `credential`, so the résumé showed no school.
    const { provider, capableCalls } = routed();
    await provider.normalizeAnswer(
      params("education_highest", "education", "Terminé la secundaria en el Colegio Nacional"),
    );
    await provider.normalizeAnswer(params("education_dates", "education", "2019"));
    expect(capableCalls).toEqual(["education_highest"]);
  });

  it("keeps the mechanical experience answers off Claude entirely", async () => {
    const { provider, capableCalls } = routed();
    // A counter payload written by the UI, and a date. No wording to interpret.
    await provider.normalizeAnswer(params("experience_type_counts", "experience", '{"caregiving":2}'));
    await provider.normalizeAnswer(params("experience_dates", "experience", "de 2019 a 2021"));
    expect(capableCalls).toEqual([]);
  });

  it("still parses those answers correctly on the deterministic side", async () => {
    const { provider } = routed();
    const counts = await provider.normalizeAnswer(
      params("experience_type_counts", "experience", '{"caregiving":2}'),
    );
    expect(counts.updates.experienceEntries).toHaveLength(2);

    const dates = await provider.normalizeAnswer(params("experience_dates", "experience", "de 2019 a 2021"));
    expect(dates.updates.experienceEntries?.[0]?.startDate).toContain("2019");
  });

  it("never sends the cheap funnel operations to Claude", async () => {
    const deterministic = new MockAIProvider();
    const capable = new MockAIProvider();
    for (const op of ["planNextQuestion", "suggestSkills"] as const) {
      vi.spyOn(capable, op).mockImplementation(() => {
        throw new Error(`${op} must not reach Claude`);
      });
    }
    const provider = new HybridAIProvider(capable, deterministic);
    await expect(
      provider.planNextQuestion({ state: state(), candidates: [], recommendedSection: "experience" }),
    ).resolves.toBeTruthy();
    await expect(
      provider.suggestSkills({ state: state(), excludeSkillNames: [] }),
    ).resolves.toBeTruthy();
  });
});

describe("thinking is spent only where it buys quality", () => {
  it("disables thinking for answer normalization", async () => {
    const { provider, create } = capturing();
    await provider.normalizeAnswer(params("experience_add", "experience")).catch(() => {});
    const body = bodyOf(create);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.output_config).toEqual({ effort: "low" });
  });

  it("disables thinking for interests and proofreading", async () => {
    for (const call of [
      (p: AnthropicProvider) => p.extractInterests({ rawAnswer: "me gusta el fútbol", existing: [] }),
      (p: AnthropicProvider) => p.proofreadResume({ items: [{ id: "a", text: "texto" }] }),
    ]) {
      const { provider, create } = capturing();
      await call(provider).catch(() => {});
      expect(bodyOf(create).thinking).toEqual({ type: "disabled" });
    }
  });

  it("spends the most on the résumé itself: thinking on at high effort", async () => {
    // Lowering this to `medium` as a cost saving produced visibly thinner résumés,
    // so generation is deliberately NOT where savings come from.
    const { provider, create } = capturing();
    await provider
      .generateResumeContent({ careerGoal: null, targetRole: "Recepcionista", experience: [], education: [], projects: [], skills: [] })
      .catch(() => {});
    const body = bodyOf(create);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "high" });
  });

  it("keeps the critique at medium — bounded output, not the final text", async () => {
    const { provider, create } = capturing();
    await provider
      .analyzeResume({
        state: state(),
        resume: { experience: [], education: [], projects: [], certifications: [], languages: [], skills: [], professionalSummary: "" } as never,
        gapHints: [],
        allowedQuestionIds: [],
      })
      .catch(() => {});
    const body = bodyOf(create);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "medium" });
  });

  it("sizes max_tokens to the task instead of one blanket ceiling", async () => {
    const { provider: p1, create: c1 } = capturing();
    await p1.normalizeAnswer(params("experience_add", "experience")).catch(() => {});
    const { provider: p2, create: c2 } = capturing();
    await p2
      .generateResumeContent({ careerGoal: null, targetRole: null, experience: [], education: [], projects: [], skills: [] })
      .catch(() => {});
    expect(bodyOf(c1).max_tokens).toBeLessThan(bodyOf(c2).max_tokens as number);
  });
});

describe("the normalizer prompt only carries the section it is about", () => {
  const other = ["educationEntries", "projects", "certifications", "languages", "achievements"];

  it("sends the experience schema and none of the others", () => {
    const prompt = buildNormalizerSystemPrompt("experience");
    expect(prompt).toContain("experienceEntries");
    for (const field of other) expect(prompt).not.toContain(field);
  });

  it("sends the education schema and its splitting rule, nothing else", () => {
    const prompt = buildNormalizerSystemPrompt("education");
    expect(prompt).toContain("educationEntries");
    expect(prompt).toContain("Colegio Nacional"); // the worked example
    expect(prompt).not.toContain("experienceEntries");
    expect(prompt).not.toContain("speakingLevel");
  });

  it("keeps section-specific rules with their section", () => {
    // Language levels belong to languages; certificate splitting to certifications.
    expect(buildNormalizerSystemPrompt("languages")).toContain("speakingLevel");
    expect(buildNormalizerSystemPrompt("experience")).not.toContain("speakingLevel");
    expect(buildNormalizerSystemPrompt("certifications")).toContain("issuingOrganization");
    expect(buildNormalizerSystemPrompt("experience")).not.toContain("issuingOrganization");
  });

  it("keeps the rules that apply to every answer", () => {
    for (const section of ["experience", "education", "languages"] as const) {
      const prompt = buildNormalizerSystemPrompt(section);
      expect(prompt).toContain("interpretationSummary");
      expect(prompt).toContain("suggestedSkills");
      // The negation rule matters everywhere now that questions cannot be skipped.
      expect(prompt).toContain("no recuerdo");
    }
  });

  it("is materially smaller than carrying every section", () => {
    // The whole point: the static half was ~4,100 characters on every call.
    expect(buildNormalizerSystemPrompt("experience").length).toBeLessThan(2600);
    expect(buildNormalizerSystemPrompt("personal_information").length).toBeLessThan(1700);
  });

  it("puts the person's answer in the variable half, not the cacheable one", () => {
    const answer = "Ayudaba en el negocio de limpieza de mi mamá";
    const p = params("experience_add", "experience", answer);
    expect(buildNormalizerUserPrompt(p)).toContain(answer);
    expect(buildNormalizerSystemPrompt("experience")).not.toContain(answer);
  });

  it("sends the stable half as a system block, ahead of the answer", async () => {
    const { provider, create } = capturing();
    await provider.normalizeAnswer(params("experience_add", "experience", "Atendía clientes")).catch(() => {});
    const body = bodyOf(create);
    // Two system blocks: factuality rules, then the task instructions. The variable
    // input is in `messages`, so the whole system prefix is byte-identical per section.
    expect(Array.isArray(body.system)).toBe(true);
    const blocks = body.system as Array<{ text: string }>;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.text).toContain("REGLAS DE VERACIDAD");
    expect(blocks[1]!.text).toContain("experienceEntries");
    expect(JSON.stringify(body.system)).not.toContain("Atendía clientes");
    expect(JSON.stringify(body.messages)).toContain("Atendía clientes");
  });

  it("keeps one system string for calls with no section schema", async () => {
    const { provider, create } = capturing();
    await provider.extractInterests({ rawAnswer: "fútbol", existing: [] }).catch(() => {});
    expect(typeof bodyOf(create).system).toBe("string");
  });
});

describe("a truncated response is not retried at the same ceiling", () => {
  function truncating() {
    const provider = new AnthropicProvider("sk-ant-test", "claude-sonnet-5");
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: '{"professionalSummary":"incompleto' }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    (provider as unknown as { client: { messages: { create: unknown } } }).client = {
      messages: { create },
    };
    return { provider, create };
  }

  it("grows the budget on each retry", async () => {
    const { provider, create } = truncating();
    await provider
      .generateResumeContent({ careerGoal: null, targetRole: null, experience: [], education: [], projects: [], skills: [] })
      .catch(() => {});

    const ceilings = create.mock.calls.map((c) => (c[0] as { max_tokens: number }).max_tokens);
    expect(ceilings.length).toBeGreaterThan(1);
    // Each attempt gets more room than the last — retrying at the same ceiling just
    // pays for the identical truncation again.
    for (let i = 1; i < ceilings.length; i++) {
      expect(ceilings[i]!).toBeGreaterThan(ceilings[i - 1]!);
    }
  });
});

describe("the thinking/effort fields survive an old SDK", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("retries without them if the API rejects them, instead of failing every call", async () => {
    const provider = new AnthropicProvider("sk-ant-test", "claude-sonnet-5");
    const create = vi
      .fn()
      // Shaped the way the SDK really surfaces a 400: the offending field name
      // lives in the response body it embeds, not necessarily in `message`.
      .mockRejectedValueOnce(
        new (Anthropic.BadRequestError as unknown as new (
          s: number,
          e: unknown,
          m: string,
          h: undefined,
        ) => Error)(
          400,
          {
            type: "error",
            error: { type: "invalid_request_error", message: "output_config: Extra inputs are not permitted" },
          },
          "400 Bad Request",
          undefined,
        ),
      )
      .mockResolvedValue({
        content: [{ type: "text", text: '{"interests":["Fútbol"]}' }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    (provider as unknown as { client: { messages: { create: unknown } } }).client = {
      messages: { create },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await provider.extractInterests({ rawAnswer: "fútbol", existing: [] });
    expect(result.interests).toEqual(["Fútbol"]);

    const second = create.mock.calls[1]![0] as Record<string, unknown>;
    expect(second.thinking).toBeUndefined();
    expect(second.output_config).toBeUndefined();
  });
});
