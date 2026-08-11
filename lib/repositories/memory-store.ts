/**
 * In-memory Store implementation. Deterministic, dependency-free, and used
 * whenever PERSISTENCE=memory (local dev + unit/e2e tests). Data lives for the
 * lifetime of the process only.
 */
import { randomUUID } from "node:crypto";
import type {
  Achievement,
  Certification,
  ConversationTurn,
  EducationEntry,
  ExperienceEntry,
  GeneratedResume,
  Language,
  PersonalInformation,
  Project,
  QuestionState,
  ResumeProfile,
  Skill,
  User,
} from "@/types";
import { Errors } from "@/lib/errors";
import type {
  CreateAchievementInput,
  CreateCertificationInput,
  CreateConversationTurnInput,
  CreateEducationInput,
  CreateExperienceInput,
  CreateGeneratedResumeInput,
  CreateLanguageInput,
  CreateProfileInput,
  CreateProjectInput,
  CreateSkillInput,
  PersonalInformationInput,
  QuestionStateInput,
  Store,
  UpdateAchievementInput,
  UpdateCertificationInput,
  UpdateEducationInput,
  UpdateExperienceInput,
  UpdateLanguageInput,
  UpdateProfileInput,
  UpdateProjectInput,
  UpdateSkillInput,
} from "./store";

const now = () => new Date().toISOString();
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export class MemoryStore implements Store {
  private users = new Map<string, User>();
  private profiles = new Map<string, ResumeProfile>();
  private personal = new Map<string, PersonalInformation>();
  private education = new Map<string, EducationEntry>();
  private experience = new Map<string, ExperienceEntry>();
  private skills = new Map<string, Skill>();
  private certifications = new Map<string, Certification>();
  private languages = new Map<string, Language>();
  private projects = new Map<string, Project>();
  private achievements = new Map<string, Achievement>();
  private turns = new Map<string, ConversationTurn>();
  private questionStates = new Map<string, QuestionState>();
  private resumes = new Map<string, GeneratedResume>();

  /** Test helper: wipe all data. */
  reset(): void {
    for (const m of [
      this.users,
      this.profiles,
      this.personal,
      this.education,
      this.experience,
      this.skills,
      this.certifications,
      this.languages,
      this.projects,
      this.achievements,
      this.turns,
      this.questionStates,
      this.resumes,
    ]) {
      (m as Map<string, unknown>).clear();
    }
  }

  private byProfile<T extends { resumeProfileId: string }>(map: Map<string, T>, profileId: string): T[] {
    return [...map.values()].filter((v) => v.resumeProfileId === profileId).map(clone);
  }

  // ── Users ──
  async getUser(userId: string): Promise<User | null> {
    return clone(this.users.get(userId) ?? null);
  }
  async upsertUser(input: { id: string; email: string; preferredLanguage?: string }): Promise<User> {
    const existing = this.users.get(input.id);
    const user: User = existing
      ? { ...existing, email: input.email, updatedAt: now() }
      : {
          id: input.id,
          email: input.email,
          preferredLanguage: input.preferredLanguage ?? "es",
          onboardingCompleted: false,
          createdAt: now(),
          updatedAt: now(),
        };
    this.users.set(user.id, user);
    return clone(user);
  }

  // ── Resume profiles ──
  async createResumeProfile(userId: string, input: CreateProfileInput): Promise<ResumeProfile> {
    const profile: ResumeProfile = {
      id: randomUUID(),
      userId,
      status: input.status ?? "draft",
      targetRole: input.targetRole ?? null,
      careerGoal: input.careerGoal ?? null,
      location: input.location ?? null,
      interests: input.interests ?? [],
      progressPercentage: input.progressPercentage ?? 0,
      currentSection: input.currentSection ?? "career_goal",
      finalizedAt: input.finalizedAt ?? null,
      termsAcceptedAt: input.termsAcceptedAt ?? null,
      termsVersion: input.termsVersion ?? null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.profiles.set(profile.id, profile);
    return clone(profile);
  }
  async getResumeProfile(id: string): Promise<ResumeProfile | null> {
    return clone(this.profiles.get(id) ?? null);
  }
  async listResumeProfilesByUser(userId: string): Promise<ResumeProfile[]> {
    return [...this.profiles.values()].filter((p) => p.userId === userId).map(clone);
  }
  async updateResumeProfile(id: string, patch: UpdateProfileInput): Promise<ResumeProfile> {
    const existing = this.profiles.get(id);
    if (!existing) throw Errors.notFound("Perfil no encontrado");
    const updated: ResumeProfile = { ...existing, ...stripUndefined(patch), updatedAt: now() };
    this.profiles.set(id, updated);
    return clone(updated);
  }

  // ── Personal information ──
  async getPersonalInformation(profileId: string): Promise<PersonalInformation | null> {
    return clone(this.personal.get(profileId) ?? null);
  }
  async upsertPersonalInformation(
    profileId: string,
    patch: PersonalInformationInput,
  ): Promise<PersonalInformation> {
    const existing =
      this.personal.get(profileId) ??
      ({
        resumeProfileId: profileId,
        firstName: null,
        lastName: null,
        city: null,
        state: null,
        country: null,
        phone: null,
        email: null,
        linkedInUrl: null,
        portfolioUrl: null,
      } satisfies PersonalInformation);
    const updated: PersonalInformation = { ...existing, ...stripUndefined(patch), resumeProfileId: profileId };
    this.personal.set(profileId, updated);
    return clone(updated);
  }

  // ── Education ──
  async createEducation(profileId: string, input: CreateEducationInput): Promise<EducationEntry> {
    const entry: EducationEntry = {
      id: randomUUID(),
      resumeProfileId: profileId,
      institution: input.institution ?? null,
      credential: input.credential ?? null,
      fieldOfStudy: input.fieldOfStudy ?? null,
      location: input.location ?? null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      isCurrent: input.isCurrent ?? false,
      relevantCoursework: input.relevantCoursework ?? [],
      projects: input.projects ?? [],
      achievements: input.achievements ?? [],
      source: input.source ?? "user_entered",
      confirmationStatus: input.confirmationStatus ?? "confirmed",
    };
    this.education.set(entry.id, entry);
    return clone(entry);
  }
  async getEducation(entryId: string): Promise<EducationEntry | null> {
    return clone(this.education.get(entryId) ?? null);
  }
  async listEducation(profileId: string): Promise<EducationEntry[]> {
    return this.byProfile(this.education, profileId);
  }
  async updateEducation(entryId: string, patch: UpdateEducationInput): Promise<EducationEntry> {
    const existing = this.education.get(entryId);
    if (!existing) throw Errors.notFound("Entrada de educación no encontrada");
    const updated = { ...existing, ...stripUndefined(patch) };
    this.education.set(entryId, updated);
    return clone(updated);
  }
  async deleteEducation(entryId: string): Promise<void> {
    this.education.delete(entryId);
  }

  // ── Experience ──
  async createExperience(profileId: string, input: CreateExperienceInput): Promise<ExperienceEntry> {
    const entry: ExperienceEntry = {
      id: randomUUID(),
      resumeProfileId: profileId,
      experienceType: input.experienceType,
      title: input.title ?? null,
      organization: input.organization ?? null,
      location: input.location ?? null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      isCurrent: input.isCurrent ?? false,
      rawDescription: input.rawDescription ?? null,
      responsibilities: input.responsibilities ?? [],
      accomplishments: input.accomplishments ?? [],
      tools: input.tools ?? [],
      peopleServed: input.peopleServed ?? null,
      metrics: input.metrics ?? [],
      source: input.source ?? "user_entered",
      confirmationStatus: input.confirmationStatus ?? "confirmed",
    };
    this.experience.set(entry.id, entry);
    return clone(entry);
  }
  async getExperience(entryId: string): Promise<ExperienceEntry | null> {
    return clone(this.experience.get(entryId) ?? null);
  }
  async listExperience(profileId: string): Promise<ExperienceEntry[]> {
    return this.byProfile(this.experience, profileId);
  }
  async updateExperience(entryId: string, patch: UpdateExperienceInput): Promise<ExperienceEntry> {
    const existing = this.experience.get(entryId);
    if (!existing) throw Errors.notFound("Entrada de experiencia no encontrada");
    const updated = { ...existing, ...stripUndefined(patch) };
    this.experience.set(entryId, updated);
    return clone(updated);
  }
  async deleteExperience(entryId: string): Promise<void> {
    this.experience.delete(entryId);
  }

  // ── Skills ──
  async createSkill(profileId: string, input: CreateSkillInput): Promise<Skill> {
    const dup = await this.findSkillByName(profileId, input.name);
    if (dup) throw Errors.conflict("La habilidad ya existe");
    const skill: Skill = {
      id: randomUUID(),
      resumeProfileId: profileId,
      name: input.name,
      category: input.category ?? "general",
      proficiency: input.proficiency ?? null,
      origin: input.origin ?? "user_entered",
      evidence: input.evidence ?? null,
      sourceEntryId: input.sourceEntryId ?? null,
      status: input.status ?? "suggested",
      createdAt: now(),
      updatedAt: now(),
    };
    this.skills.set(skill.id, skill);
    return clone(skill);
  }
  async getSkill(skillId: string): Promise<Skill | null> {
    return clone(this.skills.get(skillId) ?? null);
  }
  async listSkills(profileId: string): Promise<Skill[]> {
    return this.byProfile(this.skills, profileId);
  }
  async findSkillByName(profileId: string, name: string): Promise<Skill | null> {
    const found = [...this.skills.values()].find(
      (s) => s.resumeProfileId === profileId && s.name.toLowerCase() === name.toLowerCase(),
    );
    return clone(found ?? null);
  }
  async updateSkill(skillId: string, patch: UpdateSkillInput): Promise<Skill> {
    const existing = this.skills.get(skillId);
    if (!existing) throw Errors.notFound("Habilidad no encontrada");
    const updated: Skill = { ...existing, ...stripUndefined(patch), updatedAt: now() };
    this.skills.set(skillId, updated);
    return clone(updated);
  }
  async deleteSkill(skillId: string): Promise<void> {
    this.skills.delete(skillId);
  }

  // ── Certifications ──
  async createCertification(
    profileId: string,
    input: CreateCertificationInput,
  ): Promise<Certification> {
    const cert: Certification = {
      id: randomUUID(),
      resumeProfileId: profileId,
      name: input.name,
      issuingOrganization: input.issuingOrganization ?? null,
      issueDate: input.issueDate ?? null,
      expirationDate: input.expirationDate ?? null,
      credentialId: input.credentialId ?? null,
      credentialUrl: input.credentialUrl ?? null,
      confirmationStatus: input.confirmationStatus ?? "confirmed",
    };
    this.certifications.set(cert.id, cert);
    return clone(cert);
  }
  async getCertification(id: string): Promise<Certification | null> {
    return clone(this.certifications.get(id) ?? null);
  }
  async listCertifications(profileId: string): Promise<Certification[]> {
    return this.byProfile(this.certifications, profileId);
  }
  async updateCertification(id: string, patch: UpdateCertificationInput): Promise<Certification> {
    const existing = this.certifications.get(id);
    if (!existing) throw Errors.notFound("Certificación no encontrada");
    const updated = { ...existing, ...stripUndefined(patch) };
    this.certifications.set(id, updated);
    return clone(updated);
  }
  async deleteCertification(id: string): Promise<void> {
    this.certifications.delete(id);
  }

  // ── Languages ──
  async createLanguage(profileId: string, input: CreateLanguageInput): Promise<Language> {
    const lang: Language = {
      id: randomUUID(),
      resumeProfileId: profileId,
      name: input.name,
      speakingLevel: input.speakingLevel ?? null,
      readingLevel: input.readingLevel ?? null,
      writingLevel: input.writingLevel ?? null,
      includeOnResume: input.includeOnResume ?? true,
    };
    this.languages.set(lang.id, lang);
    return clone(lang);
  }
  async getLanguage(id: string): Promise<Language | null> {
    return clone(this.languages.get(id) ?? null);
  }
  async listLanguages(profileId: string): Promise<Language[]> {
    return this.byProfile(this.languages, profileId);
  }
  async updateLanguage(id: string, patch: UpdateLanguageInput): Promise<Language> {
    const existing = this.languages.get(id);
    if (!existing) throw Errors.notFound("Idioma no encontrado");
    const updated = { ...existing, ...stripUndefined(patch) };
    this.languages.set(id, updated);
    return clone(updated);
  }
  async deleteLanguage(id: string): Promise<void> {
    this.languages.delete(id);
  }

  // ── Projects ──
  async createProject(profileId: string, input: CreateProjectInput): Promise<Project> {
    const project: Project = {
      id: randomUUID(),
      resumeProfileId: profileId,
      name: input.name,
      projectType: input.projectType ?? null,
      organization: input.organization ?? null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      description: input.description ?? null,
      responsibilities: input.responsibilities ?? [],
      outcomes: input.outcomes ?? [],
      tools: input.tools ?? [],
      confirmationStatus: input.confirmationStatus ?? "confirmed",
    };
    this.projects.set(project.id, project);
    return clone(project);
  }
  async getProject(id: string): Promise<Project | null> {
    return clone(this.projects.get(id) ?? null);
  }
  async listProjects(profileId: string): Promise<Project[]> {
    return this.byProfile(this.projects, profileId);
  }
  async updateProject(id: string, patch: UpdateProjectInput): Promise<Project> {
    const existing = this.projects.get(id);
    if (!existing) throw Errors.notFound("Proyecto no encontrado");
    const updated = { ...existing, ...stripUndefined(patch) };
    this.projects.set(id, updated);
    return clone(updated);
  }
  async deleteProject(id: string): Promise<void> {
    this.projects.delete(id);
  }

  // ── Achievements ──
  async createAchievement(profileId: string, input: CreateAchievementInput): Promise<Achievement> {
    const achievement: Achievement = {
      id: randomUUID(),
      resumeProfileId: profileId,
      title: input.title,
      organization: input.organization ?? null,
      date: input.date ?? null,
      description: input.description ?? null,
      confirmationStatus: input.confirmationStatus ?? "confirmed",
    };
    this.achievements.set(achievement.id, achievement);
    return clone(achievement);
  }
  async getAchievement(id: string): Promise<Achievement | null> {
    return clone(this.achievements.get(id) ?? null);
  }
  async listAchievements(profileId: string): Promise<Achievement[]> {
    return this.byProfile(this.achievements, profileId);
  }
  async updateAchievement(id: string, patch: UpdateAchievementInput): Promise<Achievement> {
    const existing = this.achievements.get(id);
    if (!existing) throw Errors.notFound("Logro no encontrado");
    const updated = { ...existing, ...stripUndefined(patch) };
    this.achievements.set(id, updated);
    return clone(updated);
  }
  async deleteAchievement(id: string): Promise<void> {
    this.achievements.delete(id);
  }

  // ── Conversation turns ──
  async createConversationTurn(
    profileId: string,
    input: CreateConversationTurnInput,
  ): Promise<ConversationTurn> {
    const turn: ConversationTurn = {
      id: randomUUID(),
      resumeProfileId: profileId,
      questionId: input.questionId,
      section: input.section,
      assistantMessage: input.assistantMessage,
      userAnswer: input.userAnswer ?? null,
      normalizedAnswer: input.normalizedAnswer ?? null,
      skipped: input.skipped ?? false,
      timeSpentMs: input.timeSpentMs ?? null,
      attemptNumber: input.attemptNumber ?? 1,
      createdAt: now(),
    };
    this.turns.set(turn.id, turn);
    return clone(turn);
  }
  async listConversationTurns(profileId: string): Promise<ConversationTurn[]> {
    return this.byProfile(this.turns, profileId).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  // ── Question state ──
  async getQuestionState(profileId: string): Promise<QuestionState | null> {
    return clone(this.questionStates.get(profileId) ?? null);
  }
  async upsertQuestionState(profileId: string, patch: QuestionStateInput): Promise<QuestionState> {
    const existing =
      this.questionStates.get(profileId) ??
      ({
        resumeProfileId: profileId,
        askedQuestionIds: [],
        skippedQuestionIds: [],
        completedSections: [],
        activeSection: null,
        lastQuestionId: null,
        lastShownQuestionId: null,
        lastShownAt: null,
        lastUpdatedAt: now(),
      } satisfies QuestionState);
    const updated: QuestionState = {
      ...existing,
      ...stripUndefined(patch),
      resumeProfileId: profileId,
      lastUpdatedAt: now(),
    };
    this.questionStates.set(profileId, updated);
    return clone(updated);
  }

  // ── Generated resumes ──
  async createGeneratedResume(
    profileId: string,
    input: CreateGeneratedResumeInput,
  ): Promise<GeneratedResume> {
    const existing = this.byProfile(this.resumes, profileId);
    const version = existing.reduce((max, r) => Math.max(max, r.version), 0) + 1;
    const resume: GeneratedResume = {
      id: randomUUID(),
      resumeProfileId: profileId,
      version: input.version ?? version,
      professionalSummary: input.professionalSummary ?? "",
      skills: input.skills ?? [],
      experience: input.experience ?? [],
      education: input.education ?? [],
      certifications: input.certifications ?? [],
      projects: input.projects ?? [],
      languages: input.languages ?? [],
      html: input.html ?? "",
      pdfUrl: input.pdfUrl ?? null,
      createdAt: now(),
    };
    this.resumes.set(resume.id, resume);
    return clone(resume);
  }
  async getGeneratedResume(id: string): Promise<GeneratedResume | null> {
    return clone(this.resumes.get(id) ?? null);
  }
  async getLatestGeneratedResume(profileId: string): Promise<GeneratedResume | null> {
    const all = this.byProfile(this.resumes, profileId).sort((a, b) => b.version - a.version);
    return all[0] ?? null;
  }
  async updateGeneratedResume(
    id: string,
    patch: Partial<Pick<GeneratedResume, "pdfUrl" | "html">>,
  ): Promise<GeneratedResume> {
    const existing = this.resumes.get(id);
    if (!existing) throw Errors.notFound("Currículum generado no encontrado");
    const updated = { ...existing, ...stripUndefined(patch) };
    this.resumes.set(id, updated);
    return clone(updated);
  }
}

/** Drop keys whose value is `undefined` so a patch never nulls existing fields. */
function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
