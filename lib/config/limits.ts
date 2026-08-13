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

/**
 * Hard cap on how many experience entries a profile may hold.
 *
 * Rationale: each entry costs the user a describe question plus up to three
 * follow-ups (tasks / scope / results / dates), so an unbounded count is what
 * turns the funnel into an endless interview and drives drop-off. Four is also
 * as many as a one-page résumé can carry well.
 *
 * Enforced in CODE at every creation site — the counter step (UI + provider),
 * the answer pipeline, and `POST /api/resume-profiles/:id/experience` — not only
 * in copy. Quality then comes from curation, not volume: résumé generation
 * orders these newest-first and lets the model leave out an entry that clearly
 * does nothing for the target role (see `lib/resume/experience-order.ts` and
 * `buildResumeGenerationPrompt`).
 */
export const MAX_EXPERIENCE_ENTRIES = 4;
