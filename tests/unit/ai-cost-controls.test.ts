/**
 * Cost controls, pinned as behaviour rather than intentions.
 *
 * Two things drive cost per résumé: how many calls reach the paid model, and how
 * many output tokens each one spends (reasoning is billed at output rates). Both are
 * easy to regress silently — a new question added to a rich section quietly becomes a
 * paid call, and a dropped budget quietly turns reasoning back on everywhere.
 */
import { describe, expect, it, vi } from "vitest";
import { AzureOpenAIProvider } from "@/lib/ai/azure-openai-provider";
import { HybridAIProvider } from "@/lib/ai/hybrid-provider";
import { buildNormalizerSystemPrompt, buildNormalizerUserPrompt } from "@/lib/ai/prompts";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { completenessInput, experienceState, personalState, stateFrom } from "../helpers/factories";
import type { NormalizeAnswerParams } from "@/lib/ai/provider";
import type { ResumeProfileState } from "@/types";
import { RESUME_SECTIONS } from "@/types/domain";

const BASE_URL = "https://example-resource.cognitiveservices.azure.com/openai/v1";

function state(): ResumeProfileState {
  const base = completenessInput({
    careerGoal: "Recepcionista",
    personalInformation: personalState({ firstName: "Ana", hasEmail: true }),
    experience: [experienceState({ rawDescription: "Atendía clientes" })],
  });
  return stateFrom(base);
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
  const provider = new AzureOpenAIProvider("azure-test-key", BASE_URL, "gpt-5.3-codex");
  const create = vi.fn().mockResolvedValue({
    output_text: "{}",
    status: "completed",
    incomplete_details: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  });
  (provider as unknown as { client: { responses: { create: unknown } } }).client = {
    responses: { create },
  };
  return { provider, create };
}

const bodyOf = (create: ReturnType<typeof vi.fn>) => create.mock.calls[0]![0] as Record<string, unknown>;
const effortOf = (create: ReturnType<typeof vi.fn>) =>
  (bodyOf(create).reasoning as { effort: string } | undefined)?.effort;

describe("which answers are worth paying the model for", () => {
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

  it("sends narrative experience answers to the model", async () => {
    const { provider, capableCalls } = routed();
    await provider.normalizeAnswer(params("experience_add", "experience", "Ayudaba en el negocio de mi mamá"));
    await provider.normalizeAnswer(params("experience_daily_tasks", "experience", "Contestaba llamadas"));
    await provider.normalizeAnswer(params("experience_results", "experience", "Atendí como 20 clientes al día"));
    expect(capableCalls).toEqual(["experience_add", "experience_daily_tasks", "experience_results"]);
  });

  it("sends education narratives to the model, but not education dates", async () => {
    // One answer holds a level, a school and a subject; the deterministic parser
    // dumped the whole sentence into `credential`, so the résumé showed no school.
    const { provider, capableCalls } = routed();
    await provider.normalizeAnswer(
      params("education_highest", "education", "Terminé la secundaria en el Colegio Nacional"),
    );
    await provider.normalizeAnswer(params("education_dates", "education", "2019"));
    expect(capableCalls).toEqual(["education_highest"]);
  });

  it("keeps the mechanical experience answers off the model entirely", async () => {
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

  it("pins the WHOLE section split, so the cost boundary cannot drift undocumented", async () => {
    /*
     * The only description of this split used to be a comment, and it went stale:
     * it named education and certifications as deterministic while both were routed
     * to the model, so the written cost boundary was wrong about a third of the
     * sections. Enumerating RESUME_SECTIONS means a new section cannot be added
     * without landing here, and moving one across the line fails this test.
     */
    const { provider, capableCalls } = routed();
    for (const section of RESUME_SECTIONS) {
      // A synthetic id, so this measures the SECTION rule and not a mechanical opt-out.
      await provider.normalizeAnswer(params(`${section}_probe`, section, "algo que contó"));
    }
    const paid = RESUME_SECTIONS.filter((s) => capableCalls.includes(`${s}_probe`));
    expect(paid).toEqual([
      "education",
      "experience",
      "certifications",
      "languages",
      "projects",
      "achievements",
    ]);
    // The complement, stated once so the count is visible: 6 paid, 4 free.
    const free = RESUME_SECTIONS.filter((s) => !paid.includes(s));
    expect(free).toEqual(["career_goal", "personal_information", "skills", "review"]);
  });

  it("keeps every mechanical question off the model, whatever its section", async () => {
    // `education_dates` was the third member of MECHANICAL_QUESTION_IDS and the one
    // the comment forgot to list.
    const { provider, capableCalls } = routed();
    await provider.normalizeAnswer(params("education_dates", "education", "2019"));
    await provider.normalizeAnswer(params("experience_dates", "experience", "de 2019 a 2021"));
    await provider.normalizeAnswer(params("experience_type_counts", "experience", '{"caregiving":1}'));
    expect(capableCalls).toEqual([]);
  });

  it("never sends the cheap funnel operations to the model", async () => {
    const deterministic = new MockAIProvider();
    const capable = new MockAIProvider();
    for (const op of ["planNextQuestion", "suggestSkills"] as const) {
      vi.spyOn(capable, op).mockImplementation(() => {
        throw new Error(`${op} must not reach the paid model`);
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

describe("reasoning is spent only where it buys quality", () => {
  it("turns reasoning off entirely for answer normalization", async () => {
    const { provider, create } = capturing();
    await provider.normalizeAnswer(params("experience_add", "experience")).catch(() => {});
    // `none` is not a synonym for "low": the deployment reports 0 reasoning tokens
    // for it, so this is the cheapest the call can be.
    expect(effortOf(create)).toBe("none");
  });

  it("turns reasoning off for interests and proofreading", async () => {
    for (const call of [
      (p: AzureOpenAIProvider) => p.extractInterests({ rawAnswer: "me gusta el fútbol", existing: [] }),
      (p: AzureOpenAIProvider) => p.proofreadResume({ items: [{ id: "a", text: "texto" }] }),
    ]) {
      const { provider, create } = capturing();
      await call(provider).catch(() => {});
      expect(effortOf(create)).toBe("none");
    }
  });

  it("spends the most on the résumé itself: high effort", async () => {
    // Lowering this to `medium` as a cost saving produced visibly thinner résumés,
    // so generation is deliberately NOT where savings come from.
    const { provider, create } = capturing();
    await provider
      .generateResumeContent({ careerGoal: null, targetRole: "Recepcionista", experience: [], education: [], projects: [], skills: [] })
      .catch(() => {});
    expect(effortOf(create)).toBe("high");
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
    expect(effortOf(create)).toBe("medium");
  });

  it("sizes max_output_tokens to the task instead of one blanket ceiling", async () => {
    const { provider: p1, create: c1 } = capturing();
    await p1.normalizeAnswer(params("experience_add", "experience")).catch(() => {});
    const { provider: p2, create: c2 } = capturing();
    await p2
      .generateResumeContent({ careerGoal: null, targetRole: null, experience: [], education: [], projects: [], skills: [] })
      .catch(() => {});
    expect(bodyOf(c1).max_output_tokens).toBeLessThan(bodyOf(c2).max_output_tokens as number);
  });

  it("never asks the API to retain the person's answers", async () => {
    // The request bodies carry someone's own words about their work history.
    const { provider, create } = capturing();
    await provider.normalizeAnswer(params("experience_add", "experience")).catch(() => {});
    expect(bodyOf(create).store).toBe(false);
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

  it("sends the stable half as `instructions`, ahead of the answer", async () => {
    const { provider, create } = capturing();
    await provider.normalizeAnswer(params("experience_add", "experience", "Atendía clientes")).catch(() => {});
    const body = bodyOf(create);
    // Factuality rules, then the task instructions. The variable input travels in
    // `input`, so the whole `instructions` prefix is byte-identical per section —
    // which is what the platform's automatic prompt caching keys on.
    const instructions = body.instructions as string;
    expect(instructions.indexOf("REGLAS DE VERACIDAD")).toBeGreaterThanOrEqual(0);
    expect(instructions).toContain("experienceEntries");
    expect(instructions.indexOf("REGLAS DE VERACIDAD")).toBeLessThan(
      instructions.indexOf("experienceEntries"),
    );
    expect(instructions).not.toContain("Atendía clientes");
    expect(body.input).toContain("Atendía clientes");
  });

  it("carries only the factuality rules for calls with no section schema", async () => {
    const { provider, create } = capturing();
    await provider.extractInterests({ rawAnswer: "fútbol", existing: [] }).catch(() => {});
    const instructions = bodyOf(create).instructions as string;
    expect(instructions).toContain("REGLAS DE VERACIDAD");
    expect(instructions).not.toContain("experienceEntries");
  });
});

describe("a truncated response is not retried at the same ceiling", () => {
  function truncating() {
    const provider = new AzureOpenAIProvider("azure-test-key", BASE_URL, "gpt-5.3-codex");
    const create = vi.fn().mockResolvedValue({
      output_text: '{"professionalSummary":"incompleto',
      // How the Responses API reports running out of room, in place of the
      // `stop_reason: "max_tokens"` the Messages API used.
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    (provider as unknown as { client: { responses: { create: unknown } } }).client = {
      responses: { create },
    };
    return { provider, create };
  }

  it("grows the budget on each retry", async () => {
    const { provider, create } = truncating();
    await provider
      .generateResumeContent({ careerGoal: null, targetRole: null, experience: [], education: [], projects: [], skills: [] })
      .catch(() => {});

    const ceilings = create.mock.calls.map((c) => (c[0] as { max_output_tokens: number }).max_output_tokens);
    expect(ceilings.length).toBeGreaterThan(1);
    // Each attempt gets more room than the last — retrying at the same ceiling just
    // pays for the identical truncation again.
    for (let i = 1; i < ceilings.length; i++) {
      expect(ceilings[i]!).toBeGreaterThan(ceilings[i - 1]!);
    }
  });
});
