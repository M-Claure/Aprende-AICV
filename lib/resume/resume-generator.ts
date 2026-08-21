/**
 * Resume generation service (spec §12, §13).
 *
 * Uses ONLY confirmed/edited/approved data. Readiness is gated by the
 * deterministic completeness engine (never blocked on optional fields). Each
 * generated block is source-traced; untraceable model output is dropped.
 */
import type {
  GeneratedCertificationBlock,
  GeneratedEducationBlock,
  GeneratedExperienceBlock,
  GeneratedLanguageBlock,
  GeneratedProjectBlock,
  GeneratedResume,
  GeneratedSkillGroup,
  Language,
} from "@/types";
import { RESUME_ELIGIBLE_CONFIRMATIONS, RESUME_ELIGIBLE_SKILL_STATUSES } from "@/types/domain";
import type { AIProvider, ResumeGenerationInput } from "@/lib/ai";
import type { Store } from "@/lib/repositories/store";
import { Errors } from "@/lib/errors";
import { assembleProfileState } from "@/lib/profile-state";
import { buildSkillGroups, traceBullets } from "./source-tracing";
import { sortExperienceNewestFirst } from "./experience-order";
import { withGenerationLock } from "./generation-lock";
import { MAX_RESUME_ITERATIONS } from "@/lib/config/limits";
import { FUNNEL_COMPLETE } from "@/lib/question-engine/funnel-progress";
import type { ResumeArtifactWriter } from "./resume-artifacts";
import { getResumeGuidelines } from "./guidelines";
import { renderResumeHtml, type ResumeRenderModel } from "./resume-renderer";

export interface GeneratedResumeResult {
  resume: GeneratedResume;
  renderModel: ResumeRenderModel;
}

export async function generateResume(
  store: Store,
  ai: AIProvider,
  profileId: string,
  /**
   * Optional side-effects for the new version — in production, rendering and
   * saving the PDF (`createResumePdfWriter`). Optional so unit tests can generate
   * without Chromium; every route passes `resumeArtifacts` from the request
   * context, so the save happens on every real generation.
   */
  artifacts?: ResumeArtifactWriter,
): Promise<GeneratedResumeResult> {
  // A second concurrent request joins the first rather than paying for its own
  // generation and writing a competing version. See lib/resume/generation-lock.ts.
  // The PDF render runs inside the lock too, so two requests can never race to
  // overwrite the round's stored file with different versions.
  return withGenerationLock(profileId, () => runGeneration(store, ai, profileId, artifacts));
}

async function runGeneration(
  store: Store,
  ai: AIProvider,
  profileId: string,
  artifacts?: ResumeArtifactWriter,
): Promise<GeneratedResumeResult> {
  const profile = await store.getResumeProfile(profileId);
  if (!profile) throw Errors.notFound("Perfil no encontrado");

  // Readiness gate — deterministic, never blocks on optional fields.
  const state = await assembleProfileState(store, profileId);
  if (!state.completeness.readyToGenerate) {
    throw Errors.notReady("Aún falta información para generar el currículum.", {
      missingCriticalFields: state.completeness.missingCriticalFields,
      readiness: state.completeness.readiness,
    });
  }

  // Gather CONFIRMED-only data.
  const [personal, allExperience, allEducation, allProjects, allCerts, allLangs, allSkills] =
    await Promise.all([
      store.getPersonalInformation(profileId),
      store.listExperience(profileId),
      store.listEducation(profileId),
      store.listProjects(profileId),
      store.listCertifications(profileId),
      store.listLanguages(profileId),
      store.listSkills(profileId),
    ]);

  // Newest first — deterministically, in code. The model receives them already
  // ordered and its blocks are re-mapped onto this order below, so the résumé is
  // always reverse-chronological no matter what order the model answers in.
  const experience = sortExperienceNewestFirst(
    allExperience.filter((e) => RESUME_ELIGIBLE_CONFIRMATIONS.includes(e.confirmationStatus)),
  );
  const education = allEducation.filter((e) =>
    RESUME_ELIGIBLE_CONFIRMATIONS.includes(e.confirmationStatus),
  );
  const projects = allProjects.filter((p) =>
    RESUME_ELIGIBLE_CONFIRMATIONS.includes(p.confirmationStatus),
  );
  const certifications = allCerts.filter((c) =>
    RESUME_ELIGIBLE_CONFIRMATIONS.includes(c.confirmationStatus),
  );
  const languages = allLangs.filter((l) => l.includeOnResume);
  const skills = allSkills.filter((s) => RESUME_ELIGIBLE_SKILL_STATUSES.includes(s.status));
  const confirmedSkillStates = state.confirmedSkills;

  // Build the model input (confirmed data only).
  const input: ResumeGenerationInput = {
    careerGoal: profile.careerGoal,
    targetRole: profile.targetRole,
    experience: experience.map((e) => ({
      id: e.id,
      experienceType: e.experienceType,
      title: e.title,
      organization: e.organization,
      responsibilities: e.responsibilities,
      accomplishments: e.accomplishments,
      tools: e.tools,
      peopleServed: e.peopleServed,
      metrics: e.metrics,
      rawDescription: e.rawDescription,
    })),
    education: education.map((e) => ({
      id: e.id,
      institution: e.institution,
      credential: e.credential,
      fieldOfStudy: e.fieldOfStudy,
      relevantCoursework: e.relevantCoursework,
      achievements: e.achievements,
    })),
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      responsibilities: p.responsibilities,
      outcomes: p.outcomes,
      tools: p.tools,
    })),
    skills: skills.map((s) => ({ id: s.id, name: s.name, category: s.category })),
    guidelines: getResumeGuidelines(),
  };

  const content = await ai.generateResumeContent(input);

  // ── Assemble source-traced blocks ──
  const experienceIds = new Set(experience.map((e) => e.id));
  const educationIds = new Set(education.map((e) => e.id));
  const projectIds = new Set(projects.map((p) => p.id));
  const contentExpById = new Map(content.experience.map((e) => [e.entryId, e]));
  const contentEduById = new Map(content.education.map((e) => [e.entryId, e]));
  const contentProjById = new Map(content.projects.map((p) => [p.entryId, p]));

  /*
   * The model CURATES the experience section: the generation prompt tells it to
   * include every experience that helps the target role and to omit one only when
   * it clearly does nothing for it — omitting simply by not returning that
   * entryId. So an entry with no surviving bullets is a deliberate exclusion, not
   * an empty shell to render with a bare title.
   *
   * Guard: if that would leave the section empty (a truncated or malformed
   * generation), every entry is kept. Selection may only ever narrow what the
   * person confirmed — it never touches stored data, so an excluded experience
   * stays in the profile, editable in Review, and can come back on a regenerate.
   */
  const tracedExperience = experience.map((e) => ({
    entry: e,
    bullets: traceBullets(contentExpById.get(e.id)?.bullets ?? [], experienceIds, e.id),
  }));
  const selectedExperience = tracedExperience.filter((t) => t.bullets.length > 0);
  const includedExperience = selectedExperience.length > 0 ? selectedExperience : tracedExperience;

  const experienceBlocks: GeneratedExperienceBlock[] = includedExperience.map(({ entry: e, bullets }) => ({
    entryId: e.id,
    title: e.title,
    organization: e.organization,
    // Gives the renderer a real heading when there is no title or employer.
    experienceType: e.experienceType,
    location: e.location,
    startDate: e.startDate,
    endDate: e.endDate,
    isCurrent: e.isCurrent,
    bullets,
  }));

  const educationBlocks: GeneratedEducationBlock[] = education.map((e) => ({
    entryId: e.id,
    institution: e.institution,
    credential: e.credential,
    fieldOfStudy: e.fieldOfStudy,
    startDate: e.startDate,
    endDate: e.endDate,
    isCurrent: e.isCurrent,
    details: traceBullets(contentEduById.get(e.id)?.details ?? [], educationIds, e.id),
  }));

  const projectBlocks: GeneratedProjectBlock[] = projects.map((p) => ({
    entryId: p.id,
    name: p.name,
    bullets: traceBullets(contentProjById.get(p.id)?.bullets ?? [], projectIds, p.id),
  }));

  const skillGroups: GeneratedSkillGroup[] = buildSkillGroups(content.skillGroups, confirmedSkillStates);

  const certificationBlocks: GeneratedCertificationBlock[] = certifications.map((c) => ({
    entryId: c.id,
    name: c.name,
    issuingOrganization: c.issuingOrganization,
    issueDate: c.issueDate,
  }));

  const languageBlocks: GeneratedLanguageBlock[] = languages.map((l) => ({
    entryId: l.id,
    name: l.name,
    level: formatLanguageLevel(l),
  }));

  const fullName =
    [personal?.firstName, personal?.lastName].filter(Boolean).join(" ").trim() || "Tu Nombre";

  const renderModel: ResumeRenderModel = {
    fullName,
    headline: profile.targetRole ?? profile.careerGoal ?? null,
    location: [personal?.city, personal?.state, personal?.country].filter(Boolean).join(", ") || null,
    contact: {
      email: personal?.email ?? null,
      phone: personal?.phone ?? null,
      linkedIn: personal?.linkedInUrl ?? null,
      portfolio: personal?.portfolioUrl ?? null,
    },
    professionalSummary: content.professionalSummary,
    skills: skillGroups,
    experience: experienceBlocks,
    education: educationBlocks,
    certifications: certificationBlocks,
    projects: projectBlocks,
    languages: languageBlocks,
    interests: profile.interests ?? [],
  };

  const html = renderResumeHtml(renderModel);

  const resume = await store.createGeneratedResume(profileId, {
    stage: await resolveStage(store, profileId),
    professionalSummary: content.professionalSummary,
    skills: skillGroups,
    experience: experienceBlocks,
    education: educationBlocks,
    certifications: certificationBlocks,
    projects: projectBlocks,
    languages: languageBlocks,
    html,
  });

  // A résumé exists, so the funnel is over: record it as complete.
  //
  // The answer pipeline already reaches 100 when it runs out of questions, but a
  // user who becomes ready early can generate with optional questions still
  // outstanding — and the stored progress would then sit in the sixties forever
  // despite the funnel being finished. Done here rather than in `POST /generate`
  // so every path that produces a résumé agrees, the same reason the PDF write
  // lives at this seam.
  if (profile.progressPercentage !== FUNNEL_COMPLETE) {
    await store.updateResumeProfile(profileId, { progressPercentage: FUNNEL_COMPLETE });
  }

  // Replaces the PDF stored for this round. Never throws — see ResumeArtifactWriter.
  const stored = artifacts ? await artifacts.onResumeCreated(resume) : resume;

  return { resume: stored, renderModel };
}

/**
 * Which improvement round this generation's PDF belongs to.
 *
 * The first generation is round 0 (`curriculum.pdf`). Everything after it belongs
 * to the round currently OPEN — `iteration + 1`, the same expression
 * `POST /iterations` uses to decide which table an answer lands in. That is what
 * makes the two line up: the answers logged in `iteration_N` and the PDF written
 * at stage N are the same round.
 *
 * Deliberately keyed on the round counter rather than on the version, so a
 * mid-round `regenerate-section` or `proofread` re-renders the open round's object
 * instead of consuming the next round's. And deliberately read here rather than
 * passed in by the route: `POST /generate` bumps the counter *after* generating,
 * so anything derived from the caller's own bookkeeping would drift.
 */
async function resolveStage(store: Store, profileId: string): Promise<number> {
  const previous = await store.getLatestGeneratedResume(profileId);
  if (!previous) return 0;
  const completed = await store.getIteration(profileId);
  return Math.min(MAX_RESUME_ITERATIONS, completed + 1);
}

function formatLanguageLevel(l: Language): string | null {
  const level = l.speakingLevel ?? l.readingLevel ?? l.writingLevel;
  if (!level) return null;
  const labels: Record<string, string> = {
    basico: "Básico",
    intermedio: "Intermedio",
    avanzado: "Avanzado",
    nativo: "Nativo",
  };
  return labels[level] ?? level;
}
