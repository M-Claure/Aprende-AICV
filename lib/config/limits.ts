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

/**
 * Hard cap on how many education entries a profile may hold.
 *
 * Tighter than the experience cap because education is a shorter list by nature —
 * the highest level completed plus one course or certificate covers almost
 * everyone this product serves, and each extra entry pushes the sections that
 * actually win interviews further down the page. Longer training histories belong
 * in Certificaciones, which stays uncapped.
 *
 * Enforced at every write path — the answer pipeline and
 * `POST /api/resume-profiles/:id/education` — not only in the Review UI.
 */
export const MAX_EDUCATION_ENTRIES = 2;

/**
 * Hard cap on how many improvement questions one analysis round may ask.
 *
 * The analyzer can legitimately find a dozen: eight deterministic section gaps
 * plus one personalized deep-dive per thin experience or project. Presenting all
 * of them turns "improve your résumé" into a second funnel, and the whole point of
 * the round is a short, high-value ask the person will actually finish.
 *
 * Because a cap means choosing, the selection reserves slots for the personalized
 * deep-dives — they score lowest on priority but do the most for bullet quality,
 * and a naive top-5-by-priority would drop every one of them
 * (`lib/resume/resume-analyzer.ts` → `selectImprovements`).
 */
export const MAX_FEEDBACK_QUESTIONS_PER_ITERATION = 5;

/** How many of those slots are held for personalized entry deep-dives. */
export const DEEP_DIVE_SLOTS = 2;
