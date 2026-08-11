/**
 * Funnel exit tracking.
 *
 * A user who abandons the builder does so while looking at a question they never
 * answered — which, without this, leaves no trace at all: `adaptive_question_*`
 * only fires on a response, and `QuestionState.lastQuestionId` only records
 * questions that got one. So every place the funnel hands a question to the
 * client records it as *shown*, in two forms:
 *
 *   - an `adaptive_question_shown` analytics event, so exit rate per question is
 *     shown − (answered + skipped);
 *   - `QuestionState.lastShownQuestionId` / `lastShownAt`, so the same question
 *     is answerable in SQL against Postgres alone (Amplitude sample sizes are
 *     thin at cohort scale, and stalled profiles are found by recency).
 *
 * Best-effort: a telemetry failure must never break serving a question.
 */
import type { AdaptiveQuestion } from "@/lib/ai/schemas";
import type { Analytics } from "@/lib/analytics";
import type { Store } from "@/lib/repositories/store";

export interface QuestionShownContext {
  store: Store;
  analytics: Analytics;
  userId?: string;
}

export async function recordQuestionShown(
  ctx: QuestionShownContext,
  profileId: string,
  question: Pick<AdaptiveQuestion, "questionId" | "section" | "inputType">,
): Promise<void> {
  ctx.analytics.track(
    "adaptive_question_shown",
    {
      resumeProfileId: profileId,
      questionId: question.questionId,
      section: question.section,
      inputType: question.inputType,
    },
    ctx.userId,
  );
  try {
    await ctx.store.upsertQuestionState(profileId, {
      lastShownQuestionId: question.questionId,
      lastShownAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[funnel-telemetry] failed to record shown question", err);
  }
}
