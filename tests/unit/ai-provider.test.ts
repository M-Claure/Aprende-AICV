import { describe, expect, it } from "vitest";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { AdaptiveQuestionSchema, ResumeContentSchema } from "@/lib/ai/schemas";
import { computeCompleteness } from "@/lib/question-engine/completeness-engine";
import type { QuestionCandidate } from "@/lib/ai/provider";
import { completenessInput, experienceState, personalState, skillState } from "../helpers/factories";

const provider = new MockAIProvider();

function stateWith(overrides = {}) {
  const base = completenessInput(overrides);
  return { ...base, completeness: computeCompleteness(base) };
}

const candidates: QuestionCandidate[] = [
  {
    questionId: "career_goal_target",
    section: "career_goal",
    defaultText: "¿Qué tipo de trabajo te gustaría conseguir con este currículum?",
    inputType: "short_text",
    required: true,
    allowSkip: false,
  },
  {
    questionId: "education_highest",
    section: "education",
    defaultText: "¿Cuál es el nivel de educación más alto que completaste?",
    inputType: "short_text",
    required: false,
    allowSkip: true,
  },
];

describe("MockAIProvider.planNextQuestion", () => {
  it("chooses a candidate in the recommended section and returns a valid decision", async () => {
    const state = stateWith();
    const decision = await provider.planNextQuestion({
      state,
      candidates,
      recommendedSection: "career_goal",
    });
    expect(decision.questionId).toBe("career_goal_target");
    expect(decision.section).toBe("career_goal");
    expect(decision.nextAction).toBe("ask_question");
  });

  it("routes to skill confirmation when suggestions are pending", async () => {
    const state = stateWith({
      careerGoal: "Vendedor",
      personalInformation: personalState({ firstName: "Ana", hasEmail: true }),
      suggestedSkills: [skillState({ name: "Ventas", status: "suggested" })],
    });
    const decision = await provider.planNextQuestion({
      state,
      candidates,
      recommendedSection: "education",
    });
    expect(decision.nextAction).toBe("confirm_skills");
  });
});

describe("MockAIProvider.normalizeAnswer", () => {
  it("extracts career goal without inventing extra data", async () => {
    const state = stateWith();
    const result = await provider.normalizeAnswer({
      section: "career_goal",
      questionId: "career_goal_target",
      questionText: "¿Qué trabajo buscas?",
      rawAnswer: "Asistente administrativa",
      state,
    });
    expect(result.updates.careerGoal).toBe("Asistente administrativa");
    expect(result.suggestedSkills).toHaveLength(0);
  });

  it("infers evidence-backed skills from an experience answer", async () => {
    const state = stateWith();
    const result = await provider.normalizeAnswer({
      section: "experience",
      questionId: "experience_daily_tasks",
      questionText: "¿Qué hacías?",
      rawAnswer: "Contestaba llamadas y organizaba las citas de los clientes",
      state,
    });
    const names = result.suggestedSkills.map((s) => s.name);
    expect(names).toContain("Atención al cliente");
    expect(names).toContain("Comunicación telefónica");
    // Every suggestion must cite evidence.
    for (const s of result.suggestedSkills) expect(s.evidence.length).toBeGreaterThan(0);
  });

  it("parses a free-text languages answer into structured entries with levels", async () => {
    const state = stateWith();
    const result = await provider.normalizeAnswer({
      section: "languages",
      questionId: "languages_any",
      questionText: "¿Qué idiomas hablas y en qué nivel?",
      rawAnswer: "Hablo español nativo e inglés a nivel avanzado",
      state,
    });
    const langs = result.updates.languages ?? [];
    const byName = Object.fromEntries(langs.map((l) => [l.name, l.speakingLevel]));
    expect(byName["Español"]).toBe("nativo");
    expect(byName["Inglés"]).toBe("avanzado");
  });

  it("splits multiple certificates and extracts the issue year", async () => {
    const state = stateWith();
    const result = await provider.normalizeAnswer({
      section: "certifications",
      questionId: "certifications_any",
      questionText: "¿Tienes certificados o cursos?",
      rawAnswer: "Certificado de Excel 2022; Curso de inglés",
      state,
    });
    const certs = result.updates.certifications ?? [];
    expect(certs.length).toBe(2);
    const excel = certs.find((c) => /excel/i.test(c.name ?? ""));
    expect(excel?.issueDate).toBe("2022");
    // The year is stripped from the visible name.
    expect(excel?.name).not.toMatch(/2022/);
  });
});

describe("MockAIProvider.extractInterests", () => {
  it("returns nothing for a negative answer (never stores the negation)", async () => {
    const result = await provider.extractInterests({ rawAnswer: "no really", existing: [] });
    expect(result.interests).toEqual([]);
    const result2 = await provider.extractInterests({ rawAnswer: "ninguno", existing: [] });
    expect(result2.interests).toEqual([]);
  });

  it("extracts genuine interests and skips duplicates of existing ones", async () => {
    const result = await provider.extractInterests({
      rawAnswer: "fútbol, lectura y cocina",
      existing: ["Lectura"],
    });
    expect(result.interests).toContain("Fútbol");
    expect(result.interests).toContain("Cocina");
    // "Lectura" already exists → not duplicated.
    expect(result.interests).not.toContain("Lectura");
  });
});

describe("MockAIProvider.suggestSkills", () => {
  it("never re-suggests excluded skills", async () => {
    const exp = experienceState({
      responsibilities: ["Contestaba llamadas", "Manejaba el inventario"],
    });
    const state = stateWith({ experience: [exp] });
    const suggestions = await provider.suggestSkills({
      state,
      focusExperienceIds: [exp.id],
      excludeSkillNames: ["Comunicación telefónica"],
    });
    const names = suggestions.map((s) => s.name);
    expect(names).not.toContain("Comunicación telefónica");
    expect(names).toContain("Manejo de inventario");
  });
});

describe("MockAIProvider.generateResumeContent", () => {
  it("traces every generated bullet to a source entry", async () => {
    const content = await provider.generateResumeContent({
      careerGoal: "Asistente",
      targetRole: "Asistente administrativa",
      experience: [
        {
          id: "exp-1",
          experienceType: "family_business",
          title: null,
          organization: "Negocio familiar",
          responsibilities: ["Contestaba llamadas", "Organizaba citas"],
          accomplishments: [],
          tools: [],
          peopleServed: null,
          metrics: [],
          rawDescription: null,
        },
      ],
      education: [],
      projects: [],
      skills: [{ id: "s1", name: "Atención al cliente", category: "Servicio al cliente" }],
    });
    expect(content.professionalSummary.length).toBeGreaterThan(0);
    const bullets = content.experience.flatMap((e) => e.bullets);
    expect(bullets.length).toBeGreaterThan(0);
    for (const b of bullets) {
      expect(b.sourceEntryIds).toContain("exp-1");
      expect(b.sourceFields.length).toBeGreaterThan(0);
    }
  });
});

describe("AdaptiveQuestionSchema validation", () => {
  it("accepts a well-formed question and applies array defaults", () => {
    const parsed = AdaptiveQuestionSchema.parse({
      questionId: "q1",
      section: "experience",
      questionText: "¿Qué hacías?",
      inputType: "long_text",
      required: false,
      allowSkip: true,
      charLimit: 600,
      nextAction: "ask_question",
    });
    expect(parsed.contextUsed).toEqual([]);
    expect(parsed.suggestedSkills).toEqual([]);
  });

  it("requires a charLimit, so no question reaches the UI uncapped", () => {
    expect(() =>
      AdaptiveQuestionSchema.parse({
        questionId: "q1",
        section: "experience",
        questionText: "¿Qué hacías?",
        inputType: "long_text",
        required: false,
        allowSkip: true,
        nextAction: "ask_question",
      }),
    ).toThrow();
  });

  it("rejects an invalid section / nextAction", () => {
    expect(() =>
      AdaptiveQuestionSchema.parse({
        questionId: "q1",
        section: "not_a_section",
        questionText: "x",
        inputType: "long_text",
        required: false,
        allowSkip: true,
        nextAction: "delete_everything",
      }),
    ).toThrow();
  });
});

describe("ResumeContentSchema — tolerant of string bullets (regression)", () => {
  it("coerces string bullets/details into traceable bullet objects", () => {
    const parsed = ResumeContentSchema.parse({
      professionalSummary: "Resumen.",
      experience: [{ entryId: "e1", bullets: ["Atendí clientes", { text: "Manejé caja", sourceFields: ["tools"] }] }],
      education: [{ entryId: "ed1", details: ["Licenciatura en Economía"] }],
      projects: [],
      skillGroups: [{ category: "Herramientas", skillIds: ["s1"] }],
    });
    const b0 = parsed.experience[0]!.bullets[0]!;
    expect(b0.text).toBe("Atendí clientes");
    expect(b0.sourceEntryIds).toEqual([]);
    expect(parsed.education[0]!.details[0]!.text).toBe("Licenciatura en Economía");
  });
});

describe("ResumeContentSchema — tolerant of container field-name drift (regression)", () => {
  it("normalizes `id`→`entryId`, `skills`→`skillIds`, and education `bullets`→`details`", () => {
    // What claude-sonnet-5 actually returns when the prompt doesn't pin the exact
    // field names: block key `id` instead of `entryId`, `skills` instead of
    // `skillIds`. Before the preprocess step this failed Zod on every retry and
    // surfaced as a 502 / "La IA no devolvió una respuesta válida."
    const parsed = ResumeContentSchema.parse({
      professionalSummary: "Resumen.",
      experience: [
        { id: "e1", title: "Vendedora", bullets: [{ text: "Atendí clientes", sourceEntryIds: ["e1"], sourceFields: ["responsibilities"] }] },
      ],
      education: [{ id: "ed1", bullets: ["Bachillerato"] }],
      projects: [{ id: "p1", bullets: [{ text: "Organicé una rifa", sourceEntryIds: ["p1"], sourceFields: ["outcomes"] }] }],
      skillGroups: [{ category: "Herramientas", skills: ["s1", "s2"] }],
    });

    expect(parsed.experience[0]!.entryId).toBe("e1");
    expect(parsed.experience[0]!.bullets[0]!.text).toBe("Atendí clientes");
    expect(parsed.education[0]!.entryId).toBe("ed1");
    expect(parsed.education[0]!.details[0]!.text).toBe("Bachillerato");
    expect(parsed.projects[0]!.entryId).toBe("p1");
    expect(parsed.skillGroups[0]!.skillIds).toEqual(["s1", "s2"]);
  });

  it("leaves already-correct field names untouched", () => {
    const parsed = ResumeContentSchema.parse({
      professionalSummary: "Resumen.",
      experience: [{ entryId: "e1", bullets: [] }],
      education: [],
      projects: [],
      skillGroups: [{ category: "Herramientas", skillIds: ["s1"] }],
    });
    expect(parsed.experience[0]!.entryId).toBe("e1");
    expect(parsed.skillGroups[0]!.skillIds).toEqual(["s1"]);
  });
});
