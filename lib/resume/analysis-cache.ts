/**
 * Reuse of a résumé critique across repeated requests.
 *
 * The workspace runs an analysis when it mounts, so opening the résumé, reloading
 * the page, or navigating back each paid for a full `analyzeResume` — one of the
 * most expensive calls in the product — to produce byte-identical questions. Nothing
 * capped it either: `MAX_RESUME_ITERATIONS` limits regenerations, not analyses.
 *
 * A critique is a pure function of (the latest résumé, the profile facts the gap
 * detectors read), so it is safe to reuse until one of those changes. The
 * fingerprint below is built from exactly the fields `resume-analyzer.ts` branches
 * on — answer a follow-up or regenerate, and the key changes and a fresh analysis
 * runs, with no flag for a caller to remember to pass.
 *
 * In-process on purpose: no migration, and it targets the case that actually
 * repeats (the same person reloading within a session). A cold instance re-analyzes
 * once, which is correct rather than merely cheap.
 */
import type { GeneratedResume, ResumeProfileState } from "@/types";
import type { ResumeAnalysis } from "./resume-analyzer";

/** One entry per profile — a new fingerprint replaces the old analysis. */
const CACHE = new Map<string, { key: string; analysis: ResumeAnalysis }>();

/**
 * Bounds memory. Profiles are evicted oldest-first; an evicted profile simply pays
 * for one more analysis, so the cost of being wrong here is a cache miss.
 */
const MAX_PROFILES = 500;

/**
 * Everything the analyzer's decisions depend on, and nothing else.
 *
 * Kept deliberately close to `FOLLOWUP_DEFS[...].applies`, `thinExperience` and
 * `detectDeepDives`: if a predicate there starts reading a new field, it must be
 * added here or a stale critique will be served. Counts and presence flags are
 * enough — the analyzer branches on "is this empty / is this thin", never on the
 * text itself.
 */
export function analysisFingerprint(state: ResumeProfileState, resume: GeneratedResume): string {
  const experience = state.experience
    .map((e) =>
      [
        e.id,
        e.responsibilities.length,
        e.accomplishments.length,
        e.tools.length,
        e.metrics.length,
        e.peopleServed ? 1 : 0,
      ].join(":"),
    )
    .join("|");
  const projects = state.projects
    .map((p) => [p.id, p.responsibilities.length, p.outcomes.length, p.tools.length].join(":"))
    .join("|");
  const education = state.education
    .map((e) => [e.id, e.institution ? 1 : 0, e.relevantCoursework.length].join(":"))
    .join("|");

  return [
    // The résumé version: regenerating always earns a fresh critique.
    resume.id,
    resume.version,
    experience,
    projects,
    education,
    state.languages.length,
    state.interests.length,
    state.certifications.length,
    state.confirmedSkills.length,
  ].join("~");
}

/** The stored analysis for this exact fingerprint, or null. */
export function getCachedAnalysis(profileId: string, key: string): ResumeAnalysis | null {
  const hit = CACHE.get(profileId);
  return hit && hit.key === key ? hit.analysis : null;
}

export function setCachedAnalysis(profileId: string, key: string, analysis: ResumeAnalysis): void {
  if (!CACHE.has(profileId) && CACHE.size >= MAX_PROFILES) {
    const oldest = CACHE.keys().next();
    if (!oldest.done) CACHE.delete(oldest.value);
  }
  CACHE.set(profileId, { key, analysis });
}

/** Test seam: forget everything. */
export function clearAnalysisCache(): void {
  CACHE.clear();
}
