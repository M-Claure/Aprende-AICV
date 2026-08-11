import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
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

/**
 * Supabase (Postgres) implementation of Store. All row<->domain mapping is
 * explicit so schema column names (e.g. linkedin_url) stay decoupled from
 * domain field names (linkedInUrl).
 */
export class SupabaseStore implements Store {
  constructor(private readonly db: SupabaseClient) {}

  private unwrap<T>(res: { data: T | null; error: any }, notFoundMsg?: string): T {
    if (res.error) throw Errors.internal(res.error.message);
    if (res.data == null) throw Errors.notFound(notFoundMsg ?? "Recurso no encontrado");
    return res.data;
  }

  /**
   * Apply a partial update by id and return the resulting row.
   *
   * PostgREST treats an EMPTY patch body as "update nothing" and returns zero
   * rows — even when the filter matches an existing row. `.single()` then fails
   * with PGRST116 ("Cannot coerce the result to a single JSON object"). Since
   * every field here is optional, a patch where they were all `undefined` is a
   * legitimate no-op, not an error: return the row unchanged instead of
   * throwing. Every update path goes through this so the footgun is fixed once.
   */
  private async patchById(
    table: string,
    id: string,
    fields: Record<string, unknown>,
    notFoundMsg: string,
  ): Promise<any> {
    const patch = clean(fields);
    if (Object.keys(patch).length === 0) {
      const current = await this.db.from(table).select("*").eq("id", id).maybeSingle();
      if (current.error) throw Errors.internal(current.error.message);
      if (current.data == null) throw Errors.notFound(notFoundMsg);
      return current.data;
    }
    const res = await this.db.from(table).update(patch).eq("id", id).select("*").single();
    return this.unwrap(res, notFoundMsg);
  }

  // ── Users ──
  async getUser(userId: string): Promise<User | null> {
    const { data, error } = await this.db.from("users").select("*").eq("id", userId).maybeSingle();
    if (error) throw Errors.internal(error.message);
    return data ? mapUser(data) : null;
  }
  async upsertUser(input: { id: string; email: string; preferredLanguage?: string }): Promise<User> {
    const res = await this.db
      .from("users")
      .upsert(
        { id: input.id, email: input.email, preferred_language: input.preferredLanguage ?? "es" },
        { onConflict: "id" },
      )
      .select("*")
      .single();
    return mapUser(this.unwrap(res));
  }

  // ── Resume profiles ──
  async createResumeProfile(userId: string, input: CreateProfileInput): Promise<ResumeProfile> {
    const res = await this.db
      .from("resume_profiles")
      .insert({
        user_id: userId,
        status: input.status ?? "draft",
        target_role: input.targetRole ?? null,
        career_goal: input.careerGoal ?? null,
        location: input.location ?? null,
        interests: input.interests ?? [],
        progress_percentage: input.progressPercentage ?? 0,
        current_section: input.currentSection ?? "career_goal",
        terms_accepted_at: input.termsAcceptedAt ?? null,
        terms_version: input.termsVersion ?? null,
      })
      .select("*")
      .single();
    return mapProfile(this.unwrap(res));
  }
  async getResumeProfile(id: string): Promise<ResumeProfile | null> {
    const { data, error } = await this.db.from("resume_profiles").select("*").eq("id", id).maybeSingle();
    if (error) throw Errors.internal(error.message);
    return data ? mapProfile(data) : null;
  }
  async listResumeProfilesByUser(userId: string): Promise<ResumeProfile[]> {
    const { data, error } = await this.db.from("resume_profiles").select("*").eq("user_id", userId);
    if (error) throw Errors.internal(error.message);
    return (data ?? []).map(mapProfile);
  }
  async updateResumeProfile(id: string, patch: UpdateProfileInput): Promise<ResumeProfile> {
    return mapProfile(
      await this.patchById(
        "resume_profiles",
        id,
        {
          status: patch.status,
          target_role: patch.targetRole,
          career_goal: patch.careerGoal,
          location: patch.location,
          interests: patch.interests,
          progress_percentage: patch.progressPercentage,
          current_section: patch.currentSection,
          finalized_at: patch.finalizedAt,
          terms_accepted_at: patch.termsAcceptedAt,
          terms_version: patch.termsVersion,
        },
        "Perfil no encontrado",
      ),
    );
  }

  // ── Personal information ──
  async getPersonalInformation(profileId: string): Promise<PersonalInformation | null> {
    const { data, error } = await this.db
      .from("personal_information")
      .select("*")
      .eq("resume_profile_id", profileId)
      .maybeSingle();
    if (error) throw Errors.internal(error.message);
    return data ? mapPersonal(data) : null;
  }
  async upsertPersonalInformation(
    profileId: string,
    patch: PersonalInformationInput,
  ): Promise<PersonalInformation> {
    const res = await this.db
      .from("personal_information")
      .upsert(
        {
          resume_profile_id: profileId,
          ...clean({
            first_name: patch.firstName,
            last_name: patch.lastName,
            city: patch.city,
            state: patch.state,
            country: patch.country,
            phone: patch.phone,
            email: patch.email,
            linkedin_url: patch.linkedInUrl,
            portfolio_url: patch.portfolioUrl,
          }),
        },
        { onConflict: "resume_profile_id" },
      )
      .select("*")
      .single();
    return mapPersonal(this.unwrap(res));
  }

  // ── Education ──
  async createEducation(profileId: string, input: CreateEducationInput): Promise<EducationEntry> {
    const res = await this.db
      .from("education_entries")
      .insert({
        resume_profile_id: profileId,
        institution: input.institution ?? null,
        credential: input.credential ?? null,
        field_of_study: input.fieldOfStudy ?? null,
        location: input.location ?? null,
        start_date: input.startDate ?? null,
        end_date: input.endDate ?? null,
        is_current: input.isCurrent ?? false,
        relevant_coursework: input.relevantCoursework ?? [],
        projects: input.projects ?? [],
        achievements: input.achievements ?? [],
        source: input.source ?? "user_entered",
        confirmation_status: input.confirmationStatus ?? "confirmed",
      })
      .select("*")
      .single();
    return mapEducation(this.unwrap(res));
  }
  async getEducation(entryId: string): Promise<EducationEntry | null> {
    const { data, error } = await this.db.from("education_entries").select("*").eq("id", entryId).maybeSingle();
    if (error) throw Errors.internal(error.message);
    return data ? mapEducation(data) : null;
  }
  async listEducation(profileId: string): Promise<EducationEntry[]> {
    const { data, error } = await this.db
      .from("education_entries")
      .select("*")
      .eq("resume_profile_id", profileId)
      .order("created_at");
    if (error) throw Errors.internal(error.message);
    return (data ?? []).map(mapEducation);
  }
  async updateEducation(entryId: string, patch: UpdateEducationInput): Promise<EducationEntry> {
    return mapEducation(
      await this.patchById(
        "education_entries",
        entryId,
        {
          institution: patch.institution,
          credential: patch.credential,
          field_of_study: patch.fieldOfStudy,
          location: patch.location,
          start_date: patch.startDate,
          end_date: patch.endDate,
          is_current: patch.isCurrent,
          relevant_coursework: patch.relevantCoursework,
          projects: patch.projects,
          achievements: patch.achievements,
          source: patch.source,
          confirmation_status: patch.confirmationStatus,
        },
        "Entrada de educación no encontrada",
      ),
    );
  }
  async deleteEducation(entryId: string): Promise<void> {
    const { error } = await this.db.from("education_entries").delete().eq("id", entryId);
    if (error) throw Errors.internal(error.message);
  }

  // ── Experience ──
  async createExperience(profileId: string, input: CreateExperienceInput): Promise<ExperienceEntry> {
    const res = await this.db
      .from("experience_entries")
      .insert({
        resume_profile_id: profileId,
        experience_type: input.experienceType,
        title: input.title ?? null,
        organization: input.organization ?? null,
        location: input.location ?? null,
        start_date: input.startDate ?? null,
        end_date: input.endDate ?? null,
        is_current: input.isCurrent ?? false,
        raw_description: input.rawDescription ?? null,
        responsibilities: input.responsibilities ?? [],
        accomplishments: input.accomplishments ?? [],
        tools: input.tools ?? [],
        people_served: input.peopleServed ?? null,
        metrics: input.metrics ?? [],
        source: input.source ?? "user_entered",
        confirmation_status: input.confirmationStatus ?? "confirmed",
      })
      .select("*")
      .single();
    return mapExperience(this.unwrap(res));
  }
  async getExperience(entryId: string): Promise<ExperienceEntry | null> {
    const { data, error } = await this.db.from("experience_entries").select("*").eq("id", entryId).maybeSingle();
    if (error) throw Errors.internal(error.message);
    return data ? mapExperience(data) : null;
  }
  async listExperience(profileId: string): Promise<ExperienceEntry[]> {
    const { data, error } = await this.db
      .from("experience_entries")
      .select("*")
      .eq("resume_profile_id", profileId)
      .order("created_at");
    if (error) throw Errors.internal(error.message);
    return (data ?? []).map(mapExperience);
  }
  async updateExperience(entryId: string, patch: UpdateExperienceInput): Promise<ExperienceEntry> {
    return mapExperience(
      await this.patchById(
        "experience_entries",
        entryId,
        {
          experience_type: patch.experienceType,
          title: patch.title,
          organization: patch.organization,
          location: patch.location,
          start_date: patch.startDate,
          end_date: patch.endDate,
          is_current: patch.isCurrent,
          raw_description: patch.rawDescription,
          responsibilities: patch.responsibilities,
          accomplishments: patch.accomplishments,
          tools: patch.tools,
          people_served: patch.peopleServed,
          metrics: patch.metrics,
          source: patch.source,
          confirmation_status: patch.confirmationStatus,
        },
        "Entrada de experiencia no encontrada",
      ),
    );
  }
  async deleteExperience(entryId: string): Promise<void> {
    const { error } = await this.db.from("experience_entries").delete().eq("id", entryId);
    if (error) throw Errors.internal(error.message);
  }

  // ── Skills ──
  async createSkill(profileId: string, input: CreateSkillInput): Promise<Skill> {
    const res = await this.db
      .from("skills")
      .insert({
        resume_profile_id: profileId,
        name: input.name,
        category: input.category ?? "general",
        proficiency: input.proficiency ?? null,
        origin: input.origin ?? "user_entered",
        evidence: input.evidence ?? null,
        source_entry_id: input.sourceEntryId ?? null,
        status: input.status ?? "suggested",
      })
      .select("*")
      .single();
    if (res.error?.code === "23505") throw Errors.conflict("La habilidad ya existe");
    return mapSkill(this.unwrap(res));
  }
  async getSkill(skillId: string): Promise<Skill | null> {
    const { data, error } = await this.db.from("skills").select("*").eq("id", skillId).maybeSingle();
    if (error) throw Errors.internal(error.message);
    return data ? mapSkill(data) : null;
  }
  async listSkills(profileId: string): Promise<Skill[]> {
    const { data, error } = await this.db.from("skills").select("*").eq("resume_profile_id", profileId);
    if (error) throw Errors.internal(error.message);
    return (data ?? []).map(mapSkill);
  }
  async findSkillByName(profileId: string, name: string): Promise<Skill | null> {
    const { data, error } = await this.db
      .from("skills")
      .select("*")
      .eq("resume_profile_id", profileId)
      .ilike("name", name)
      .maybeSingle();
    if (error) throw Errors.internal(error.message);
    return data ? mapSkill(data) : null;
  }
  async updateSkill(skillId: string, patch: UpdateSkillInput): Promise<Skill> {
    return mapSkill(
      await this.patchById(
        "skills",
        skillId,
        {
          name: patch.name,
          category: patch.category,
          proficiency: patch.proficiency,
          origin: patch.origin,
          evidence: patch.evidence,
          source_entry_id: patch.sourceEntryId,
          status: patch.status,
        },
        "Habilidad no encontrada",
      ),
    );
  }
  async deleteSkill(skillId: string): Promise<void> {
    const { error } = await this.db.from("skills").delete().eq("id", skillId);
    if (error) throw Errors.internal(error.message);
  }

  // ── Certifications ──
  async createCertification(profileId: string, input: CreateCertificationInput): Promise<Certification> {
    const res = await this.db
      .from("certifications")
      .insert({
        resume_profile_id: profileId,
        name: input.name,
        issuing_organization: input.issuingOrganization ?? null,
        issue_date: input.issueDate ?? null,
        expiration_date: input.expirationDate ?? null,
        credential_id: input.credentialId ?? null,
        credential_url: input.credentialUrl ?? null,
        confirmation_status: input.confirmationStatus ?? "confirmed",
      })
      .select("*")
      .single();
    return mapCertification(this.unwrap(res));
  }
  async getCertification(id: string): Promise<Certification | null> {
    const { data, error } = await this.db.from("certifications").select("*").eq("id", id).maybeSingle();
    if (error) throw Errors.internal(error.message);
    return data ? mapCertification(data) : null;
  }
  async listCertifications(profileId: string): Promise<Certification[]> {
    const { data, error } = await this.db.from("certifications").select("*").eq("resume_profile_id", profileId);
    if (error) throw Errors.internal(error.message);
    return (data ?? []).map(mapCertification);
  }
  async updateCertification(id: string, patch: UpdateCertificationInput): Promise<Certification> {
    return mapCertification(
      await this.patchById(
        "certifications",
        id,
        {
          name: patch.name,
          issuing_organization: patch.issuingOrganization,
          issue_date: patch.issueDate,
          expiration_date: patch.expirationDate,
          credential_id: patch.credentialId,
          credential_url: patch.credentialUrl,
          confirmation_status: patch.confirmationStatus,
        },
        "Certificación no encontrada",
      ),
    );
  }
  async deleteCertification(id: string): Promise<void> {
    const { error } = await this.db.from("certifications").delete().eq("id", id);
    if (error) throw Errors.internal(error.message);
  }

  // ── Languages ──
  async createLanguage(profileId: string, input: CreateLanguageInput): Promise<Language> {
    const res = await this.db
      .from("languages")
      .insert({
        resume_profile_id: profileId,
        name: input.name,
        speaking_level: input.speakingLevel ?? null,
        reading_level: input.readingLevel ?? null,
        writing_level: input.writingLevel ?? null,
        include_on_resume: input.includeOnResume ?? true,
      })
      .select("*")
      .single();
    return mapLanguage(this.unwrap(res));
  }
  async getLanguage(id: string): Promise<Language | null> {
    const { data, error } = await this.db.from("languages").select("*").eq("id", id).maybeSingle();
    if (error) throw Errors.internal(error.message);
    return data ? mapLanguage(data) : null;
  }
  async listLanguages(profileId: string): Promise<Language[]> {
    const { data, error } = await this.db.from("languages").select("*").eq("resume_profile_id", profileId);
    if (error) throw Errors.internal(error.message);
    return (data ?? []).map(mapLanguage);
  }
  async updateLanguage(id: string, patch: UpdateLanguageInput): Promise<Language> {
    return mapLanguage(
      await this.patchById(
        "languages",
        id,
        {
          name: patch.name,
          speaking_level: patch.speakingLevel,
          reading_level: patch.readingLevel,
          writing_level: patch.writingLevel,
          include_on_resume: patch.includeOnResume,
        },
        "Idioma no encontrado",
      ),
    );
  }
  async deleteLanguage(id: string): Promise<void> {
    const { error } = await this.db.from("languages").delete().eq("id", id);
    if (error) throw Errors.internal(error.message);
  }

  // ── Projects ──
  async createProject(profileId: string, input: CreateProjectInput): Promise<Project> {
    const res = await this.db
      .from("projects")
      .insert({
        resume_profile_id: profileId,
        name: input.name,
        project_type: input.projectType ?? null,
        organization: input.organization ?? null,
        start_date: input.startDate ?? null,
        end_date: input.endDate ?? null,
        description: input.description ?? null,
        responsibilities: input.responsibilities ?? [],
        outcomes: input.outcomes ?? [],
        tools: input.tools ?? [],
        confirmation_status: input.confirmationStatus ?? "confirmed",
      })
      .select("*")
      .single();
    return mapProject(this.unwrap(res));
  }
  async getProject(id: string): Promise<Project | null> {
    const { data, error } = await this.db.from("projects").select("*").eq("id", id).maybeSingle();
    if (error) throw Errors.internal(error.message);
    return data ? mapProject(data) : null;
  }
  async listProjects(profileId: string): Promise<Project[]> {
    const { data, error } = await this.db.from("projects").select("*").eq("resume_profile_id", profileId);
    if (error) throw Errors.internal(error.message);
    return (data ?? []).map(mapProject);
  }
  async updateProject(id: string, patch: UpdateProjectInput): Promise<Project> {
    return mapProject(
      await this.patchById(
        "projects",
        id,
        {
          name: patch.name,
          project_type: patch.projectType,
          organization: patch.organization,
          start_date: patch.startDate,
          end_date: patch.endDate,
          description: patch.description,
          responsibilities: patch.responsibilities,
          outcomes: patch.outcomes,
          tools: patch.tools,
          confirmation_status: patch.confirmationStatus,
        },
        "Proyecto no encontrado",
      ),
    );
  }
  async deleteProject(id: string): Promise<void> {
    const { error } = await this.db.from("projects").delete().eq("id", id);
    if (error) throw Errors.internal(error.message);
  }

  // ── Achievements ──
  async createAchievement(profileId: string, input: CreateAchievementInput): Promise<Achievement> {
    const res = await this.db
      .from("achievements")
      .insert({
        resume_profile_id: profileId,
        title: input.title,
        organization: input.organization ?? null,
        date: input.date ?? null,
        description: input.description ?? null,
        confirmation_status: input.confirmationStatus ?? "confirmed",
      })
      .select("*")
      .single();
    return mapAchievement(this.unwrap(res));
  }
  async getAchievement(id: string): Promise<Achievement | null> {
    const { data, error } = await this.db.from("achievements").select("*").eq("id", id).maybeSingle();
    if (error) throw Errors.internal(error.message);
    return data ? mapAchievement(data) : null;
  }
  async listAchievements(profileId: string): Promise<Achievement[]> {
    const { data, error } = await this.db.from("achievements").select("*").eq("resume_profile_id", profileId);
    if (error) throw Errors.internal(error.message);
    return (data ?? []).map(mapAchievement);
  }
  async updateAchievement(id: string, patch: UpdateAchievementInput): Promise<Achievement> {
    return mapAchievement(
      await this.patchById(
        "achievements",
        id,
        {
          title: patch.title,
          organization: patch.organization,
          date: patch.date,
          description: patch.description,
          confirmation_status: patch.confirmationStatus,
        },
        "Logro no encontrado",
      ),
    );
  }
  async deleteAchievement(id: string): Promise<void> {
    const { error } = await this.db.from("achievements").delete().eq("id", id);
    if (error) throw Errors.internal(error.message);
  }

  // ── Conversation turns ──
  async createConversationTurn(
    profileId: string,
    input: CreateConversationTurnInput,
  ): Promise<ConversationTurn> {
    const core = {
      resume_profile_id: profileId,
      question_id: input.questionId,
      section: input.section,
      assistant_message: input.assistantMessage,
      user_answer: input.userAnswer ?? null,
      normalized_answer: input.normalizedAnswer ?? null,
      skipped: input.skipped ?? false,
    };
    const telemetry = {
      time_spent_ms: input.timeSpentMs ?? null,
      attempt_number: input.attemptNumber ?? 1,
    };
    const res = await this.db
      .from("conversation_turns")
      .insert({ ...core, ...telemetry })
      .select("*")
      .single();

    // The telemetry columns arrive in migration 0005. If the code is deployed
    // before the migration is applied, save the turn anyway — losing the user's
    // answer to a missing analytics column is never the right trade.
    if (res.error && isUnknownColumnError(res.error)) {
      console.error(
        "[supabase-store] conversation_turns is missing the 0005 telemetry columns; " +
          "saving the turn without them. Apply supabase/migrations/0005_funnel_telemetry.sql.",
      );
      const retry = await this.db.from("conversation_turns").insert(core).select("*").single();
      return mapTurn(this.unwrap(retry));
    }
    return mapTurn(this.unwrap(res));
  }
  async listConversationTurns(profileId: string): Promise<ConversationTurn[]> {
    const { data, error } = await this.db
      .from("conversation_turns")
      .select("*")
      .eq("resume_profile_id", profileId)
      .order("created_at");
    if (error) throw Errors.internal(error.message);
    return (data ?? []).map(mapTurn);
  }

  // ── Question state ──
  async getQuestionState(profileId: string): Promise<QuestionState | null> {
    const { data, error } = await this.db
      .from("question_states")
      .select("*")
      .eq("resume_profile_id", profileId)
      .maybeSingle();
    if (error) throw Errors.internal(error.message);
    return data ? mapQuestionState(data) : null;
  }
  async upsertQuestionState(profileId: string, patch: QuestionStateInput): Promise<QuestionState> {
    const res = await this.db
      .from("question_states")
      .upsert(
        {
          resume_profile_id: profileId,
          ...clean({
            asked_question_ids: patch.askedQuestionIds,
            skipped_question_ids: patch.skippedQuestionIds,
            completed_sections: patch.completedSections,
            active_section: patch.activeSection,
            last_question_id: patch.lastQuestionId,
            last_shown_question_id: patch.lastShownQuestionId,
            last_shown_at: patch.lastShownAt,
          }),
          last_updated_at: new Date().toISOString(),
        },
        { onConflict: "resume_profile_id" },
      )
      .select("*")
      .single();
    return mapQuestionState(this.unwrap(res));
  }

  // ── Generated resumes ──
  async createGeneratedResume(
    profileId: string,
    input: CreateGeneratedResumeInput,
  ): Promise<GeneratedResume> {
    let version = input.version;
    if (version == null) {
      const latest = await this.getLatestGeneratedResume(profileId);
      version = (latest?.version ?? 0) + 1;
    }
    const res = await this.db
      .from("generated_resumes")
      .insert({
        resume_profile_id: profileId,
        version,
        professional_summary: input.professionalSummary ?? "",
        skills: input.skills ?? [],
        experience: input.experience ?? [],
        education: input.education ?? [],
        certifications: input.certifications ?? [],
        projects: input.projects ?? [],
        languages: input.languages ?? [],
        html: input.html ?? "",
        pdf_url: input.pdfUrl ?? null,
      })
      .select("*")
      .single();
    return mapGeneratedResume(this.unwrap(res));
  }
  async getGeneratedResume(id: string): Promise<GeneratedResume | null> {
    const { data, error } = await this.db.from("generated_resumes").select("*").eq("id", id).maybeSingle();
    if (error) throw Errors.internal(error.message);
    return data ? mapGeneratedResume(data) : null;
  }
  async getLatestGeneratedResume(profileId: string): Promise<GeneratedResume | null> {
    const { data, error } = await this.db
      .from("generated_resumes")
      .select("*")
      .eq("resume_profile_id", profileId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw Errors.internal(error.message);
    return data ? mapGeneratedResume(data) : null;
  }
  async updateGeneratedResume(
    id: string,
    patch: Partial<Pick<GeneratedResume, "pdfUrl" | "html">>,
  ): Promise<GeneratedResume> {
    return mapGeneratedResume(
      await this.patchById(
        "generated_resumes",
        id,
        { pdf_url: patch.pdfUrl, html: patch.html },
        "Currículum generado no encontrado",
      ),
    );
  }
}

// ── Mappers (row -> domain) ─────────────────────────────────────────────────
function mapUser(r: any): User {
  return {
    id: r.id,
    email: r.email,
    preferredLanguage: r.preferred_language,
    onboardingCompleted: r.onboarding_completed,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function mapProfile(r: any): ResumeProfile {
  return {
    id: r.id,
    userId: r.user_id,
    status: r.status,
    targetRole: r.target_role,
    careerGoal: r.career_goal,
    location: r.location,
    interests: r.interests ?? [],
    progressPercentage: r.progress_percentage,
    currentSection: r.current_section,
    finalizedAt: r.finalized_at ?? null,
    termsAcceptedAt: r.terms_accepted_at ?? null,
    termsVersion: r.terms_version ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function mapPersonal(r: any): PersonalInformation {
  return {
    resumeProfileId: r.resume_profile_id,
    firstName: r.first_name,
    lastName: r.last_name,
    city: r.city,
    state: r.state,
    country: r.country,
    phone: r.phone,
    email: r.email,
    linkedInUrl: r.linkedin_url,
    portfolioUrl: r.portfolio_url,
  };
}
function mapEducation(r: any): EducationEntry {
  return {
    id: r.id,
    resumeProfileId: r.resume_profile_id,
    institution: r.institution,
    credential: r.credential,
    fieldOfStudy: r.field_of_study,
    location: r.location,
    startDate: r.start_date,
    endDate: r.end_date,
    isCurrent: r.is_current,
    relevantCoursework: r.relevant_coursework ?? [],
    projects: r.projects ?? [],
    achievements: r.achievements ?? [],
    source: r.source,
    confirmationStatus: r.confirmation_status,
  };
}
function mapExperience(r: any): ExperienceEntry {
  return {
    id: r.id,
    resumeProfileId: r.resume_profile_id,
    experienceType: r.experience_type,
    title: r.title,
    organization: r.organization,
    location: r.location,
    startDate: r.start_date,
    endDate: r.end_date,
    isCurrent: r.is_current,
    rawDescription: r.raw_description,
    responsibilities: r.responsibilities ?? [],
    accomplishments: r.accomplishments ?? [],
    tools: r.tools ?? [],
    peopleServed: r.people_served,
    metrics: r.metrics ?? [],
    source: r.source,
    confirmationStatus: r.confirmation_status,
  };
}
function mapSkill(r: any): Skill {
  return {
    id: r.id,
    resumeProfileId: r.resume_profile_id,
    name: r.name,
    category: r.category,
    proficiency: r.proficiency,
    origin: r.origin,
    evidence: r.evidence,
    sourceEntryId: r.source_entry_id,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function mapCertification(r: any): Certification {
  return {
    id: r.id,
    resumeProfileId: r.resume_profile_id,
    name: r.name,
    issuingOrganization: r.issuing_organization,
    issueDate: r.issue_date,
    expirationDate: r.expiration_date,
    credentialId: r.credential_id,
    credentialUrl: r.credential_url,
    confirmationStatus: r.confirmation_status,
  };
}
function mapLanguage(r: any): Language {
  return {
    id: r.id,
    resumeProfileId: r.resume_profile_id,
    name: r.name,
    speakingLevel: r.speaking_level,
    readingLevel: r.reading_level,
    writingLevel: r.writing_level,
    includeOnResume: r.include_on_resume,
  };
}
function mapProject(r: any): Project {
  return {
    id: r.id,
    resumeProfileId: r.resume_profile_id,
    name: r.name,
    projectType: r.project_type,
    organization: r.organization,
    startDate: r.start_date,
    endDate: r.end_date,
    description: r.description,
    responsibilities: r.responsibilities ?? [],
    outcomes: r.outcomes ?? [],
    tools: r.tools ?? [],
    confirmationStatus: r.confirmation_status,
  };
}
function mapAchievement(r: any): Achievement {
  return {
    id: r.id,
    resumeProfileId: r.resume_profile_id,
    title: r.title,
    organization: r.organization,
    date: r.date,
    description: r.description,
    confirmationStatus: r.confirmation_status,
  };
}
function mapTurn(r: any): ConversationTurn {
  return {
    id: r.id,
    resumeProfileId: r.resume_profile_id,
    questionId: r.question_id,
    section: r.section,
    assistantMessage: r.assistant_message,
    userAnswer: r.user_answer,
    normalizedAnswer: r.normalized_answer,
    skipped: r.skipped,
    timeSpentMs: r.time_spent_ms ?? null,
    attemptNumber: r.attempt_number ?? 1,
    createdAt: r.created_at,
  };
}
function mapQuestionState(r: any): QuestionState {
  return {
    resumeProfileId: r.resume_profile_id,
    askedQuestionIds: r.asked_question_ids ?? [],
    skippedQuestionIds: r.skipped_question_ids ?? [],
    completedSections: r.completed_sections ?? [],
    activeSection: r.active_section,
    lastQuestionId: r.last_question_id,
    lastShownQuestionId: r.last_shown_question_id ?? null,
    lastShownAt: r.last_shown_at ?? null,
    lastUpdatedAt: r.last_updated_at,
  };
}
function mapGeneratedResume(r: any): GeneratedResume {
  return {
    id: r.id,
    resumeProfileId: r.resume_profile_id,
    version: r.version,
    professionalSummary: r.professional_summary,
    skills: r.skills ?? [],
    experience: r.experience ?? [],
    education: r.education ?? [],
    certifications: r.certifications ?? [],
    projects: r.projects ?? [],
    languages: r.languages ?? [],
    html: r.html,
    pdfUrl: r.pdf_url,
    createdAt: r.created_at,
  };
}

/** Remove undefined keys so partial updates don't overwrite columns with null. */
/**
 * True for "this column does not exist" — PostgREST reports a schema-cache miss
 * as PGRST204, Postgres itself as 42703. Used to tolerate an additive migration
 * that has not been applied yet.
 */
function isUnknownColumnError(error: { code?: string | null }): boolean {
  return error.code === "PGRST204" || error.code === "42703";
}

function clean<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}
