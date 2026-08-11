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

  const experience = allExperience.filter((e) =>
    RESUME_ELIGIBLE_CONFIRMATIONS.includes(e.confirmationStatus),
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

  const experienceBlocks: GeneratedExperienceBlock[] = experience.map((e) => ({
    entryId: e.id,
    title: e.title,
    organization: e.organization,
    location: e.location,
    startDate: e.startDate,
    endDate: e.endDate,
    isCurrent: e.isCurrent,
    bullets: traceBullets(contentExpById.get(e.id)?.bullets ?? [], experienceIds, e.id),
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
    professionalSummary: content.professionalSummary,
    skills: skillGroups,
    experience: experienceBlocks,
    education: educationBlocks,
    certifications: certificationBlocks,
    projects: projectBlocks,
    languages: languageBlocks,
    html,
  });

  return { resume, renderModel };
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
