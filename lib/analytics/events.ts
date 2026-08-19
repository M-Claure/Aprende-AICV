/**
 * Analytics event catalog (spec §18). Only funnel/behavioral data is tracked —
 * never raw resume answers or sensitive personal information.
 */
export const ANALYTICS_EVENTS = [
  "resume_funnel_started",
  "career_goal_completed",
  "personal_information_completed",
  "education_entry_added",
  "experience_entry_added",
  /**
   * A question was served to the client. Emitted wherever the funnel hands a
   * question to the UI, so exit rate per question can be computed as
   * shown − (answered + skipped) — the question a user abandons produces no
   * other event. A refresh re-serves the same question, so count DISTINCT
   * profiles per questionId rather than raw event volume.
   */
  "adaptive_question_shown",
  "adaptive_question_answered",
  "adaptive_question_skipped",
  "skill_suggested",
  "skill_confirmed",
  "skill_rejected",
  "profile_review_started",
  "resume_generation_started",
  "resume_generated",
  "resume_section_edited",
  "resume_proofread",
  "resume_finalized",
  /**
   * A PDF was rendered and written to storage, replacing the profile's previous
   * one. Emitted on every generation, not only on download — the gap between
   * this and `resume_generated` is the PDF save-failure rate.
   */
  "resume_pdf_stored",
  "pdf_export_started",
  "resume_downloaded",
  "funnel_abandoned",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/**
 * Allow-list of property keys that are safe to send. Anything not on this list
 * is dropped so raw answers / PII can never leak into analytics.
 */
export const SAFE_PROPERTY_KEYS = [
  "resumeProfileId",
  "currentSection",
  "section",
  "experienceType",
  "completenessScore",
  "readiness",
  "questionId",
  "userSegment",
  "deviceCategory",
  "timeSpentMs",
  "skipped",
  "skillCount",
  "inputType",
  "version",
  /** Nth time this question has been answered by this profile (1-based). */
  "attemptNumber",
] as const;

export type AnalyticsProps = Partial<Record<(typeof SAFE_PROPERTY_KEYS)[number], string | number | boolean>>;

/** Drop any key not on the allow-list; coerce nothing, invent nothing. */
export function sanitizeProps(props: Record<string, unknown>): AnalyticsProps {
  const out: Record<string, string | number | boolean> = {};
  for (const key of SAFE_PROPERTY_KEYS) {
    const v = props[key];
    if (v === undefined || v === null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[key] = v;
  }
  return out;
}
