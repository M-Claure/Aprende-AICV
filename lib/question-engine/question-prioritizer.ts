/**
 * Deterministic question prioritization (spec §7). Produces the ordered set of
 * catalog questions the AI planner is allowed to choose from. The prioritizer —
 * not the model — enforces:
 *   - never re-ask an answered question (unless it is repeatable),
 *   - a skipped question is not re-asked immediately (only if it is critical for
 *     generation and the profile is not yet ready),
 *   - once the profile is ready, stop exploring and steer toward review.
 */
import type { ResumeProfileState } from "@/types";
import type { QuestionCandidate } from "@/lib/ai/provider";
import { QUESTION_CATALOG, getCatalogQuestion, type CatalogQuestion } from "./question-catalog";

const MAX_CANDIDATES = 6;

export function buildCandidates(state: ResumeProfileState): QuestionCandidate[] {
  const answered = new Set(state.answeredQuestionIds);
  const skipped = new Set(state.skippedQuestionIds);
  const ready = state.completeness.readyToGenerate;
  const recommended = state.completeness.recommendedSection;

  const eligible = QUESTION_CATALOG.filter((q) => {
    if (!q.precondition(state)) return false;
    if (answered.has(q.id) && !q.repeatable) return false;
    if (skipped.has(q.id)) {
      // Skipped questions come back only if critical AND still blocking readiness.
      const revisit = q.criticalForGeneration === true && !ready;
      if (!revisit) return false;
    }
    return true;
  });

  // Once ready, drop repeatable "add another…" questions so the flow converges
  // on review instead of letting the planner keep re-picking them.
  const converged = ready ? eligible.filter((q) => !q.repeatable) : eligible;

  // When the profile is ready, don't keep exploring optional sections.
  const pool = ready ? preferReview(converged) : converged;

  const sorted = [...pool].sort((a, b) => {
    const aRec = a.section === recommended ? 0 : 1;
    const bRec = b.section === recommended ? 0 : 1;
    if (aRec !== bRec) return aRec - bRec;
    return a.priority - b.priority;
  });

  return sorted.slice(0, MAX_CANDIDATES).map((q) => toCandidate(q, state));
}

/** Ensure the review question leads and trim exploratory questions. */
function preferReview(eligible: CatalogQuestion[]): CatalogQuestion[] {
  const review = getCatalogQuestion("review_summary");
  const withoutOptional = eligible.filter(
    (q) => q.criticalForGeneration || q.section === "review" || q.section === "skills",
  );
  const base = withoutOptional.length > 0 ? withoutOptional : eligible;
  if (review && !base.some((q) => q.id === "review_summary")) return [review, ...base];
  return base;
}

function toCandidate(q: CatalogQuestion, state: ResumeProfileState): QuestionCandidate {
  return {
    questionId: q.id,
    section: q.section,
    // Catalog text may be a function of state (e.g. "tu voluntariado 2 de 3").
    defaultText: typeof q.text === "function" ? q.text(state) : q.text,
    inputType: q.inputType,
    required: q.required,
    allowSkip: q.allowSkip,
    options: q.options,
    intent: q.intent,
  };
}
