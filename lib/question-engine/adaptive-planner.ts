/**
 * Adaptive question planner (spec §6 Layer 2, §8).
 *
 * The deterministic prioritizer decides WHAT is eligible; the model only PICKS
 * and personalizes from that set. This module:
 *   1. builds candidates deterministically,
 *   2. asks the provider to choose + personalize (validated PlannerDecision),
 *   3. re-checks questionId ∈ candidates (defense beyond Zod),
 *   4. fills inputType/options/required/allowSkip/nextAction from the CATALOG,
 *      never from the model,
 *   5. returns a strict AdaptiveQuestion.
 */
import type { ResumeProfileState } from "@/types";
import type { AIProvider } from "@/lib/ai";
import { AdaptiveQuestionSchema, type AdaptiveQuestion, type NextAction } from "@/lib/ai/schemas";
import { answerCharLimitForQuestion } from "@/lib/answer-limits";
import { buildCandidates } from "./question-prioritizer";
import { getCatalogQuestion } from "./question-catalog";

export async function planNextQuestion(
  state: ResumeProfileState,
  provider: AIProvider,
): Promise<AdaptiveQuestion> {
  const candidates = buildCandidates(state);

  // Nothing left to ask — go straight to review or generation.
  if (candidates.length === 0) {
    return AdaptiveQuestionSchema.parse({
      questionId: "review_summary",
      section: "review",
      questionText: state.completeness.readyToGenerate
        ? "Tienes suficiente información para generar tu currículum. ¿Quieres revisarlo y generarlo?"
        : "Repasemos lo que falta para completar tu currículum.",
      inputType: "review",
      required: false,
      allowSkip: true,
      charLimit: answerCharLimitForQuestion("review_summary"),
      nextAction: state.completeness.readyToGenerate ? "generate_resume" : "review_profile",
    });
  }

  const candidateIds = new Set(candidates.map((c) => c.questionId));
  const decision = await provider.planNextQuestion({
    state,
    candidates,
    recommendedSection: state.completeness.recommendedSection,
  });

  // Enforce that the model chose an allowed question; otherwise use the top one.
  const chosenId = candidateIds.has(decision.questionId) ? decision.questionId : candidates[0]!.questionId;
  const catalog = getCatalogQuestion(chosenId);
  const candidate = candidates.find((c) => c.questionId === chosenId)!;

  const inputType = catalog?.inputType ?? candidate.inputType;
  const nextAction = deriveNextAction(inputType, candidate.section);

  const suggestedSkills =
    inputType === "skill_confirmation"
      ? state.suggestedSkills.map((s) => ({
          name: s.name,
          category: s.category,
          evidence: s.evidence ?? "",
        }))
      : [];

  return AdaptiveQuestionSchema.parse({
    questionId: chosenId,
    section: candidate.section,
    questionText: chosenId === decision.questionId ? decision.questionText : candidate.defaultText,
    supportingText: decision.supportingText ?? catalog?.supportingText,
    reasonForAsking: decision.reasonForAsking ?? catalog?.intent,
    exampleAnswer: decision.exampleAnswer ?? catalog?.exampleAnswer,
    inputType,
    options: catalog?.options ?? candidate.options,
    required: catalog?.required ?? candidate.required,
    allowSkip: catalog?.allowSkip ?? candidate.allowSkip,
    skipLabel: catalog?.skipLabel,
    // Same rule as inputType: the limit is the catalog's, never the model's.
    charLimit: answerCharLimitForQuestion(chosenId),
    contextUsed: decision.contextUsed,
    suggestedSkills,
    nextAction,
  });
}

function deriveNextAction(inputType: string, section: string): NextAction {
  if (inputType === "skill_confirmation") return "confirm_skills";
  if (section === "review") return "review_profile";
  return "ask_question";
}
