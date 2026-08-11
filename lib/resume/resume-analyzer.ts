/**
 * Resume analysis for the improvement loop. Critiques a generated résumé and
 * proposes targeted follow-up questions to make it stronger.
 *
 * Design: deterministic gap detection is the source of truth for which
 * follow-ups are actionable (each maps to a known, routable questionId). The AI
 * adds an overall impression, strengths, and better-worded questions — but the
 * server fills section/inputType from FOLLOWUP_DEFS (never trusting the model
 * for routing) and guarantees the detected gaps are present.
 */
import type { ResumeProfileState } from "@/types";
import type { AIProvider } from "@/lib/ai";
import type { InputType } from "@/lib/ai/schemas";
import { followUpCharLimit } from "@/lib/answer-limits";
import { Errors } from "@/lib/errors";
import type { Store } from "@/lib/repositories/store";
import { assembleProfileState } from "@/lib/profile-state";
import { getResumeGuidelines } from "./guidelines";

interface FollowupDef {
  /** Display grouping. A real ResumeSection for pipeline routing, or "interests". */
  section: string;
  inputType: InputType;
  title: string;
  defaultQuestion: string;
  /** Whether this follow-up is relevant given the current profile. */
  applies: (s: ResumeProfileState) => boolean;
  /** Lower = surfaced first. */
  priority: number;
}

const has = (v: string | null | undefined) => typeof v === "string" && v.trim().length > 0;
const thinExperience = (s: ResumeProfileState) =>
  s.experience.some((e) => e.responsibilities.length + e.accomplishments.length < 3);

/**
 * The allow-listed follow-ups. All non-"interests" questionIds are real catalog
 * questions the answer pipeline already handles; "interests" routes to the
 * interests endpoint. (personal_location is intentionally omitted — the generic
 * normalizer would misread a city as a name.)
 */
export const FOLLOWUP_DEFS: Record<string, FollowupDef> = {
  experience_results: {
    section: "experience",
    inputType: "long_text",
    title: "Añade resultados a tu experiencia",
    defaultQuestion:
      "¿Hubo algún resultado o logro concreto en tu experiencia? Puede ser una cantidad aproximada y verdadera.",
    applies: (s) => s.experience.some((e) => e.accomplishments.length === 0 && e.metrics.length === 0),
    priority: 1,
  },
  experience_scope: {
    section: "experience",
    inputType: "long_text",
    title: "Amplía lo que hacías",
    defaultQuestion:
      "¿Qué herramientas usabas y a quién atendías (clientes, personas, documentos, dinero, inventario)?",
    applies: (s) => s.experience.some((e) => e.tools.length === 0 || !has(e.peopleServed)),
    priority: 2,
  },
  skills_add: {
    section: "skills",
    inputType: "long_text",
    title: "Suma más habilidades",
    defaultQuestion: "¿Qué otras habilidades tienes? Escríbelas separadas por comas.",
    applies: (s) => s.confirmedSkills.length < 3,
    priority: 3,
  },
  languages_any: {
    section: "languages",
    inputType: "long_text",
    title: "Agrega los idiomas que hablas",
    defaultQuestion: "¿Qué idiomas hablas y en qué nivel? (por ejemplo: español nativo, inglés básico)",
    applies: (s) => s.languages.length === 0,
    priority: 4,
  },
  interests: {
    section: "interests",
    inputType: "short_text",
    title: "Añade tus intereses",
    defaultQuestion: "¿Qué intereses o pasatiempos te gustaría incluir? Sepáralos por comas.",
    applies: (s) => s.interests.length === 0,
    priority: 5,
  },
  projects_any: {
    section: "projects",
    inputType: "long_text",
    title: "Incluye un proyecto",
    defaultQuestion: "¿Has hecho algún proyecto personal, escolar o comunitario que quieras mostrar?",
    applies: (s) => s.projects.length === 0,
    priority: 6,
  },
  certifications_any: {
    section: "certifications",
    inputType: "long_text",
    title: "Agrega certificados o cursos",
    defaultQuestion: "¿Tienes certificados o cursos que quieras incluir?",
    applies: (s) => s.certifications.length === 0,
    priority: 7,
  },
  education_details: {
    section: "education",
    inputType: "long_text",
    title: "Detalla tu educación",
    defaultQuestion: "¿Dónde estudiaste y qué aprendiste que sea relevante para este puesto?",
    applies: (s) => s.education.some((e) => !has(e.institution) || e.relevantCoursework.length === 0),
    priority: 8,
  },
};

/** Entry deep-dive question ids (personalized questions about a specific entry). */
const DEEPEN_TYPES: Record<string, "experience" | "project"> = {
  experience_deepen: "experience",
  project_deepen: "project",
};

export interface AnalysisImprovement {
  questionId: string;
  section: string;
  inputType: InputType;
  title: string;
  detail: string;
  followUpQuestion: string;
  /**
   * Max characters for the answer, resolved server-side (never from the client)
   * so the counter the UI shows is exactly what the endpoint will accept.
   */
  charLimit: number;
  /** Set for entry deep-dives — the answer enriches this specific entry. */
  entryType?: "experience" | "project";
  entryId?: string;
}

/** An improvement before its limit is attached — the shape the builders below produce. */
type ImprovementDraft = Omit<AnalysisImprovement, "charLimit">;

const withCharLimit = (i: ImprovementDraft): AnalysisImprovement => ({
  ...i,
  charLimit: followUpCharLimit(i.questionId, i.inputType),
});

export interface ResumeAnalysis {
  overallImpression: string;
  strengths: string[];
  improvements: AnalysisImprovement[];
}

/** Deterministic gaps → baseline improvements (always routable). */
function detectGaps(state: ResumeProfileState): ImprovementDraft[] {
  const out: ImprovementDraft[] = [];
  for (const [questionId, def] of Object.entries(FOLLOWUP_DEFS)) {
    // Treat thin experience as a stronger trigger for the experience follow-ups.
    const applies = def.applies(state) || (def.section === "experience" && thinExperience(state));
    if (!applies) continue;
    out.push({
      questionId,
      section: def.section,
      inputType: def.inputType,
      title: def.title,
      detail: "",
      followUpQuestion: def.defaultQuestion,
    });
  }
  return out.sort((a, b) => FOLLOWUP_DEFS[a.questionId]!.priority - FOLLOWUP_DEFS[b.questionId]!.priority);
}

/** Personalized deep-dive questions targeting specific thin experience/project entries. */
function detectDeepDives(state: ResumeProfileState): ImprovementDraft[] {
  const out: ImprovementDraft[] = [];
  for (const e of state.experience) {
    const thin = e.tools.length === 0 || e.responsibilities.length + e.accomplishments.length < 3;
    if (!thin) continue;
    const label = e.title || e.organization || "esta experiencia";
    out.push({
      questionId: "experience_deepen",
      entryType: "experience",
      entryId: e.id,
      section: "experience",
      inputType: "long_text",
      title: `Cuéntame más sobre «${label}»`,
      detail: "Más detalle (herramientas, cómo lo hiciste, resultados) hace esta experiencia mucho más fuerte.",
      followUpQuestion: `Sobre «${label}»: ¿qué herramientas o programas usaste y cómo lo lograste?`,
    });
  }
  for (const p of state.projects) {
    const thin = p.tools.length === 0 || p.responsibilities.length + p.outcomes.length < 2;
    if (!thin) continue;
    out.push({
      questionId: "project_deepen",
      entryType: "project",
      entryId: p.id,
      section: "project",
      inputType: "long_text",
      title: `Cuéntame más sobre «${p.name}»`,
      detail: "Explica qué herramientas usaste, cómo lo construiste y qué lograste.",
      followUpQuestion: `Sobre «${p.name}»: ¿qué herramientas o tecnologías usaste, cómo lo hiciste y qué resultado obtuviste?`,
    });
  }
  return out;
}

function buildGapHints(state: ResumeProfileState): string[] {
  return [...detectGaps(state), ...detectDeepDives(state)].map((g) => g.title);
}

export async function analyzeResume(store: Store, ai: AIProvider, profileId: string): Promise<ResumeAnalysis> {
  const state = await assembleProfileState(store, profileId);
  const resume = await store.getLatestGeneratedResume(profileId);
  if (!resume) throw Errors.notFound("Aún no se ha generado un currículum para analizar.");

  const gaps = detectGaps(state);
  const deepDives = detectDeepDives(state);
  const experienceIds = new Set(state.experience.map((e) => e.id));
  const projectIds = new Set(state.projects.map((p) => p.id));

  // The AI adds impression/strengths/better wording, but the deterministic gaps +
  // deep-dives are the routable source of truth. If the AI call fails (validation,
  // truncation, network), fall back to a deterministic analysis instead of hard-
  // failing the whole improvement loop with a 502.
  let ai_result: Awaited<ReturnType<AIProvider["analyzeResume"]>>;
  try {
    ai_result = await ai.analyzeResume({
      state,
      resume,
      gapHints: buildGapHints(state),
      allowedQuestionIds: [...Object.keys(FOLLOWUP_DEFS), ...Object.keys(DEEPEN_TYPES)],
      guidelines: getResumeGuidelines(),
    });
  } catch (err) {
    console.error("[analyzeResume] AI analysis failed; using deterministic gaps only.", err);
    return {
      overallImpression:
        "Tu currículum ya tiene una base sólida. Responde las siguientes preguntas para hacerlo más completo y fuerte.",
      strengths: [],
      improvements: [...gaps, ...deepDives]
        .sort((a, b) => (FOLLOWUP_DEFS[a.questionId]?.priority ?? 50) - (FOLLOWUP_DEFS[b.questionId]?.priority ?? 50))
        .map(withCharLimit),
    };
  }

  // Merge: deterministic gaps + deep-dives are the routable baseline; the AI
  // enriches matching items (better/personalized wording). Keyed by questionId
  // plus entryId so multiple deep-dives (one per entry) coexist.
  const key = (i: { questionId: string; entryId?: string }) => `${i.questionId}:${i.entryId ?? ""}`;
  const byId = new Map<string, ImprovementDraft>();
  for (const g of [...gaps, ...deepDives]) byId.set(key(g), g);

  for (const imp of ai_result.improvements) {
    const deepenType = DEEPEN_TYPES[imp.questionId];
    if (deepenType) {
      // Entry deep-dive: entryId must reference a real entry of the right type.
      const valid = deepenType === "experience" ? experienceIds.has(imp.entryId ?? "") : projectIds.has(imp.entryId ?? "");
      if (!valid) continue;
      byId.set(key(imp), {
        questionId: imp.questionId,
        entryType: deepenType,
        entryId: imp.entryId,
        section: deepenType,
        inputType: "long_text",
        title: imp.title,
        detail: imp.detail,
        followUpQuestion: imp.followUpQuestion,
      });
      continue;
    }
    const def = FOLLOWUP_DEFS[imp.questionId];
    if (!def) continue; // ignore questionIds outside the allow-list
    byId.set(key(imp), {
      questionId: imp.questionId,
      section: def.section,
      inputType: def.inputType,
      title: imp.title || def.title,
      detail: imp.detail,
      followUpQuestion: imp.followUpQuestion || def.defaultQuestion,
    });
  }

  // Order: section gaps by priority first, then per-entry deep-dives.
  const improvements = [...byId.values()]
    .sort((a, b) => {
      const pa = FOLLOWUP_DEFS[a.questionId]?.priority ?? 50;
      const pb = FOLLOWUP_DEFS[b.questionId]?.priority ?? 50;
      return pa - pb;
    })
    .map(withCharLimit);

  return {
    overallImpression: ai_result.overallImpression,
    strengths: ai_result.strengths,
    improvements,
  };
}
