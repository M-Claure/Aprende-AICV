/**
 * Funnel progress — the number behind the bar the user watches.
 *
 * PURE: no I/O, no LLM, no randomness.
 *
 * ## Why this is not `completeness.overallScore`
 * `overallScore` is a *data-quality* score: a weighted average over five buckets
 * (objective, identity, background, skills, languages). It is the right input for
 * readiness, the review dashboard and the model prompt, and the wrong number for
 * a progress bar, because:
 *
 *  * **It stalls.** Most funnel questions land in a bucket that is already
 *    saturated, or inside `background`, which is a `max()` over education /
 *    experience / projects — so improving the weaker one moves nothing. Driving
 *    the real funnel, three consecutive questions moved it by 0 points.
 *  * **It can go backwards.** The education and experience buckets *average* over
 *    entries, so adding an entry (the counter opens one per experience the user
 *    reports) lowers the average until it is filled in.
 *  * **It cannot reach 100 by finishing.** Readiness fires while the optional
 *    buckets are still empty, and the funnel then deliberately converges on
 *    review — so a user who answers everything they are asked lands in the
 *    seventies or eighties and the bar never completes.
 *
 * ## What this measures instead
 * Questions dealt with, over questions dealt with plus questions left — where
 * "left" is the same eligibility rule the funnel itself follows
 * (`eligibleQuestions`), so the bar can only disagree with what the user is
 * actually asked if those two get out of sync, which is impossible by
 * construction.
 *
 * The properties that follow are the ones a progress bar needs:
 *  * every answer moves the numerator, so there is no bucket to saturate;
 *  * it reaches 100 exactly when the funnel has nothing left to ask.
 *
 * ## Why the estimate alone is not the bar
 * The denominator is an estimate and it can GROW: answering the experience
 * counter tells the funnel how many experiences exist, which opens a follow-up
 * per entry. Driving the real funnel, that one answer moved the raw ratio from
 * 43 to 29 — a bar going backwards, which reads as losing work.
 *
 * That revision is unavoidable (before the answer the funnel genuinely does not
 * know how big the job is), so it is absorbed rather than shown:
 * `assembleProfileState` floors the estimate at the value already persisted, and
 * `advanceFunnelProgress` — the write side, called once per answer — guarantees
 * at least a point of movement so absorbing a revision never freezes the bar.
 */
import type { ResumeProfileState } from "@/types";
import { eligibleQuestions } from "./question-prioritizer";
import { getCatalogQuestion } from "./question-catalog";

/**
 * The terminus, not work: `review_summary` is the screen the funnel ends ON, so
 * counting it as outstanding would hold the bar below 100 forever.
 */
const TERMINAL_QUESTION_ID = "review_summary";

/**
 * Full. Only ever reported when the funnel has nothing left to ask — or when a
 * résumé has been generated, which is the funnel's other terminus
 * (`lib/resume/resume-generator.ts`).
 */
export const FUNNEL_COMPLETE = 100;
const COMPLETE = FUNNEL_COMPLETE;

/**
 * Raw progress estimate, 0..100. May dip when the denominator grows — callers
 * floor it (see the note above), so this stays the honest measurement.
 *
 * Takes the state *with* its completeness report, because eligibility depends on
 * readiness — completeness is computed first, then this (see `lib/profile-state.ts`).
 */
export function estimateFunnelProgress(state: ResumeProfileState): number {
  const remaining = eligibleQuestions(state).filter((q) => q.id !== TERMINAL_QUESTION_ID).length;

  // Nothing left to ask: the funnel is finished, whatever the data looks like.
  // Stated first so it cannot be undone by an odd `answered` count.
  if (remaining === 0) return COMPLETE;

  const answered = countHandled(state);
  // Before the first answer there is no progress to report, and 0/0 is not 0.
  if (answered === 0) return 0;

  // Held below 100 while anything is outstanding: a bar that reads 100 with a
  // question still on screen is worse than one that reads 97.
  return Math.min(COMPLETE - 1, Math.round((answered / (answered + remaining)) * COMPLETE));
}

/**
 * The value to persist after an answer, given what was last persisted and what
 * the state now shows.
 *
 * Monotone, and guaranteed to move: when a grown denominator has pulled the
 * estimate back under `previous`, `previous + 1` keeps the bar advancing instead
 * of parking it until the estimate catches up. Capped at 99 short of completion,
 * so 100 means "the funnel has nothing left to ask" and nothing else.
 */
export function advanceFunnelProgress(previous: number, shown: number): number {
  if (shown >= COMPLETE) return COMPLETE;
  return Math.min(COMPLETE - 1, Math.max(shown, previous + 1));
}

/**
 * Questions the user has dealt with — answered or skipped.
 *
 * A skip counts: the user was shown the question and moved past it, and the
 * funnel will not (except for a critical one still blocking readiness) ask it
 * again, so leaving skips out would strand the bar for anyone who skips a lot.
 *
 * Counted against the CATALOG so a stored id that no longer exists — a question
 * renamed or removed in a later release — cannot inflate progress past what the
 * denominator knows about.
 */
function countHandled(state: ResumeProfileState): number {
  const handled = new Set<string>();
  for (const id of state.answeredQuestionIds) {
    if (id !== TERMINAL_QUESTION_ID && getCatalogQuestion(id)) handled.add(id);
  }
  for (const id of state.skippedQuestionIds) {
    if (id !== TERMINAL_QUESTION_ID && getCatalogQuestion(id)) handled.add(id);
  }
  return handled.size;
}
