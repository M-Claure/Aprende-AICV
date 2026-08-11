/**
 * Product limits shared between UI screens. Plain constants only (no imports),
 * safe to use from client components and server code alike.
 *
 * Per-answer and per-field CHARACTER limits live in `lib/answer-limits.ts`
 * instead — they need the question catalog to resolve a limit from a questionId,
 * which would break this file's no-imports rule.
 */

/**
 * Hard cap on how many times a user can improve/regenerate their résumé in the
 * workspace after the initial generation. Reaching it disables every
 * regenerate path and steers the user to review + download.
 */
export const MAX_RESUME_ITERATIONS = 3;
