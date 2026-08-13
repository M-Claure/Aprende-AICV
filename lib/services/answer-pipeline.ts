/**
 * Answer-processing pipeline (spec §9).
 *
 * Order of operations (auth + request validation happen in the route handler):
 *   3. load profile → 4. save raw answer → 5. normalize → 6. validate (in provider)
 *   7. surface material interpretation → 8. update section → 9. recompute completeness
 *   10. generate skill suggestions → 11. determine next question → 12. return state.
 *
 * The original user wording is always preserved (ConversationTurn.userAnswer and,
 * for experience, ExperienceEntry.rawDescription) alongside normalized values.
 */
import type { AdaptiveQuestion } from "@/lib/ai/schemas";
import type { AnswerNormalization } from "@/lib/ai/schemas";
import type { ResumeProfileState, ResumeSection, Skill } from "@/types";
import type { AIProvider } from "@/lib/ai";
import type { Analytics } from "@/lib/analytics";
import type { Store } from "@/lib/repositories/store";
import { Errors } from "@/lib/errors";
import { MAX_EXPERIENCE_ENTRIES } from "@/lib/config/limits";
import { assembleProfileState } from "@/lib/profile-state";
import { planNextQuestion } from "@/lib/question-engine/adaptive-planner";
import { getCatalogQuestion } from "@/lib/question-engine/question-catalog";
import { inferAndPersistSkills } from "@/lib/skills/skill-inference";
import { addUserSkill, applySkillDecisions, type SkillEdit } from "@/lib/skills/skill-confirmation";
import { isExperienceUndescribed } from "@/lib/experience-types";
import { recordQuestionShown } from "@/lib/services/funnel-telemetry";

export interface PipelineContext {
  store: Store;
  ai: AIProvider;
  analytics: Analytics;
  userId?: string;
}

export interface ProcessAnswerInput {
  profileId: string;
  questionId: string;
  section: ResumeSection;
  rawAnswer?: string | null;
  skipped?: boolean;
  skillDecisions?: { confirm?: string[]; reject?: string[]; edit?: Array<{ id: string } & SkillEdit> };
  timeSpentMs?: number;
  deviceCategory?: string;
  /**
   * When set, an entry-creating answer OVERWRITES this existing entry instead of
   * creating a new one. Used when the user goes back and re-answers a question.
   */
  targetEntryId?: string;
}

export interface ProcessAnswerResult {
  profileState: ResumeProfileState;
  nextQuestion: AdaptiveQuestion;
  interpretation: { summary: string; needsConfirmation: boolean } | null;
  suggestedSkills: Skill[];
  /** The education/experience entry this answer created or updated (for back-edit). */
  affectedEntryId: string | null;
}

const EXPERIENCE_UPDATE_Q = new Set([
  "experience_daily_tasks",
  "experience_scope",
  "experience_results",
  "experience_dates",
]);
const EDUCATION_UPDATE_Q = new Set(["education_details", "education_dates"]);
const EXPERIENCE_CONTENT_Q = new Set(["experience_add", "experience_daily_tasks", "experience_scope"]);

export async function processAnswer(
  ctx: PipelineContext,
  input: ProcessAnswerInput,
): Promise<ProcessAnswerResult> {
  const { store, ai, analytics, userId } = ctx;

  // 3. Load profile.
  const profile = await store.getResumeProfile(input.profileId);
  if (!profile) throw Errors.notFound("Perfil no encontrado");

  const catalog = getCatalogQuestion(input.questionId);
  // Catalog text may be a function of state (e.g. the per-entry describe prompt);
  // resolve it against the pre-answer state for the audit record. Only assembled
  // when actually needed (function-typed text).
  const questionText =
    typeof catalog?.text === "function"
      ? catalog.text(await assembleProfileState(store, input.profileId))
      : (catalog?.text ?? input.questionId);
  const qs = (await store.getQuestionState(input.profileId)) ?? null;

  // Effort telemetry: how many times this profile has already responded to this
  // question. >1 means the user came back and redid it — the strongest signal
  // that a question is confusing. Computed before the new turn is written.
  const priorTurns = await store.listConversationTurns(input.profileId);
  const attemptNumber = priorTurns.filter((t) => t.questionId === input.questionId).length + 1;

  let interpretation: ProcessAnswerResult["interpretation"] = null;
  let suggestedSkills: Skill[] = [];
  let affectedEntryId: string | null = null;

  if (input.skipped) {
    // 4. Record the skip; do not normalize.
    await store.createConversationTurn(input.profileId, {
      questionId: input.questionId,
      section: input.section,
      assistantMessage: questionText,
      userAnswer: null,
      skipped: true,
      timeSpentMs: input.timeSpentMs ?? null,
      attemptNumber,
    });
    await store.upsertQuestionState(input.profileId, {
      skippedQuestionIds: dedupe([...(qs?.skippedQuestionIds ?? []), input.questionId]),
      askedQuestionIds: qs?.askedQuestionIds ?? [],
      lastQuestionId: input.questionId,
      activeSection: input.section,
    });
    analytics.track("adaptive_question_skipped", {
      resumeProfileId: input.profileId,
      questionId: input.questionId,
      section: input.section,
      skipped: true,
      timeSpentMs: input.timeSpentMs,
      deviceCategory: input.deviceCategory,
      attemptNumber,
    }, userId);
  } else {
    const raw = (input.rawAnswer ?? "").trim();

    // 5–8. Route by question type.
    if (input.questionId === "skills_confirm") {
      const decisions = input.skillDecisions ?? {};
      await applySkillDecisions(store, decisions);
      analytics.track("skill_confirmed", {
        resumeProfileId: input.profileId,
        skillCount: decisions.confirm?.length ?? 0,
      }, userId);
      if (decisions.reject?.length) {
        analytics.track("skill_rejected", {
          resumeProfileId: input.profileId,
          skillCount: decisions.reject.length,
        }, userId);
      }
      interpretation = { summary: "Actualicé tus habilidades según tu confirmación.", needsConfirmation: false };
    } else if (input.questionId === "skills_add") {
      const names = raw
        .split(/[,;\n]+|\s+y\s+/i)
        .map((s) => s.trim())
        .filter((s) => s.length > 1);
      for (const name of names) await addUserSkill(store, input.profileId, { name });
      interpretation = { summary: "Agregué las habilidades que indicaste.", needsConfirmation: false };
    } else {
      // Normalize via the AI provider (validated inside the provider).
      const stateBefore = await assembleProfileState(store, input.profileId);
      const norm = await ai.normalizeAnswer({
        section: input.section,
        questionId: input.questionId,
        questionText,
        rawAnswer: raw,
        state: stateBefore,
      });
      const applied = await applyNormalization(store, input.profileId, input.questionId, norm, input.targetEntryId);
      interpretation = { summary: norm.interpretationSummary, needsConfirmation: norm.needsConfirmation };
      affectedEntryId = applied.affectedEntryId;

      // 10. Evidence-based skill suggestions after experience content answers.
      if (EXPERIENCE_CONTENT_Q.has(input.questionId)) {
        const stateAfter = await assembleProfileState(store, input.profileId);
        suggestedSkills = await inferAndPersistSkills(store, ai, stateAfter, {
          focusExperienceIds: applied.targetExperienceId ? [applied.targetExperienceId] : undefined,
        });
        if (suggestedSkills.length > 0) {
          analytics.track("skill_suggested", {
            resumeProfileId: input.profileId,
            skillCount: suggestedSkills.length,
          }, userId);
        }
      }

      emitSectionAnalytics(analytics, input, applied, userId);
    }

    // 4 (cont). Persist the raw answer + normalized interpretation for audit.
    await store.createConversationTurn(input.profileId, {
      questionId: input.questionId,
      section: input.section,
      assistantMessage: questionText,
      userAnswer: raw,
      normalizedAnswer: interpretation,
      skipped: false,
      timeSpentMs: input.timeSpentMs ?? null,
      attemptNumber,
    });
    await store.upsertQuestionState(input.profileId, {
      askedQuestionIds: dedupe([...(qs?.askedQuestionIds ?? []), input.questionId]),
      skippedQuestionIds: (qs?.skippedQuestionIds ?? []).filter((id) => id !== input.questionId),
      lastQuestionId: input.questionId,
      activeSection: input.section,
    });
    analytics.track("adaptive_question_answered", {
      resumeProfileId: input.profileId,
      questionId: input.questionId,
      section: input.section,
      skipped: false,
      timeSpentMs: input.timeSpentMs,
      deviceCategory: input.deviceCategory,
      attemptNumber,
    }, userId);
  }

  // 9. Recompute completeness on the fresh state.
  const profileState = await assembleProfileState(store, input.profileId);

  const status = profileState.completeness.readyToGenerate
    ? "ready_for_review"
    : "collecting_information";

  // 11. Determine the next question.
  const nextQuestion = await planNextQuestion(profileState, ai);

  await store.upsertQuestionState(input.profileId, {
    completedSections: profileState.completeness.completedSections,
  });

  // Record the question we are about to serve as shown — if the user quits now,
  // this is the exit point. Deliberately a separate, failure-tolerant write:
  // analytics must never be able to break answering a question.
  await recordQuestionShown({ store, analytics, userId }, input.profileId, nextQuestion);

  await store.updateResumeProfile(input.profileId, {
    status,
    progressPercentage: profileState.completeness.overallScore,
    currentSection: nextQuestion.section,
  });

  return { profileState, nextQuestion, interpretation, suggestedSkills, affectedEntryId };
}

// ── Applying normalized updates to the store ────────────────────────────────

interface AppliedChanges {
  targetExperienceId: string | null;
  addedExperience: boolean;
  addedEducation: boolean;
  /** The education/experience entry created or updated by this answer. */
  affectedEntryId: string | null;
}

async function applyNormalization(
  store: Store,
  profileId: string,
  questionId: string,
  norm: AnswerNormalization,
  targetEntryId?: string,
): Promise<AppliedChanges> {
  const u = norm.updates;
  let targetExperienceId: string | null = null;
  let affectedEntryId: string | null = null;
  let addedExperience = false;
  let addedEducation = false;

  if (u.careerGoal !== undefined || u.targetRole !== undefined) {
    await store.updateResumeProfile(profileId, {
      careerGoal: ov(u.careerGoal),
      targetRole: ov(u.targetRole),
    });
  }

  if (u.personalInformation) {
    const p = u.personalInformation;
    await store.upsertPersonalInformation(profileId, {
      firstName: ov(p.firstName),
      lastName: ov(p.lastName),
      city: ov(p.city),
      state: ov(p.state),
      country: ov(p.country),
      phone: ov(p.phone),
      email: ov(p.email),
      linkedInUrl: ov(p.linkedInUrl),
      portfolioUrl: ov(p.portfolioUrl),
    });
  }

  if (u.educationEntries?.length) {
    // Overwrite a specific entry (back-edit), the most-recent (follow-up), or create.
    const explicit = targetEntryId ? await store.getEducation(targetEntryId) : null;
    const list = await store.listEducation(profileId);
    const target = explicit ?? (EDUCATION_UPDATE_Q.has(questionId) ? list[list.length - 1] : undefined);
    if (target) {
      const updated = await store.updateEducation(target.id, mapEducation(u.educationEntries[0]!));
      affectedEntryId = updated.id;
    } else {
      for (const e of u.educationEntries) {
        const created = await store.createEducation(profileId, mapEducation(e));
        affectedEntryId = created.id;
        addedEducation = true;
      }
    }
  }

  if (u.experienceEntries?.length) {
    const explicit = targetEntryId ? await store.getExperience(targetEntryId) : null;
    const list = await store.listExperience(profileId);
    // The describe step fills the FIRST still-undescribed entry (so it walks the
    // entries created by the counter step in order); enrichment updates the
    // latest; everything else creates.
    let target = explicit ?? undefined;
    if (!target) {
      if (questionId === "experience_add") {
        target = list.find(isExperienceUndescribed);
      } else if (EXPERIENCE_UPDATE_Q.has(questionId)) {
        target = list[list.length - 1];
      }
    }
    if (target) {
      const updated = await store.updateExperience(target.id, mapExperience(u.experienceEntries[0]!));
      targetExperienceId = updated.id;
      affectedEntryId = updated.id;
    } else {
      // The cap is enforced HERE, at the write, not only in the counter UI: the
      // count arrives as a free-text answer the model normalizes, so nothing
      // upstream can guarantee how many entries come back. Extra entries are
      // dropped rather than failing the answer — the ones that fit are still
      // captured, and the funnel then walks the person through describing them.
      const room = Math.max(0, MAX_EXPERIENCE_ENTRIES - list.length);
      for (const e of u.experienceEntries.slice(0, room)) {
        const created = await store.createExperience(profileId, mapExperienceCreate(e));
        targetExperienceId = created.id;
        affectedEntryId = created.id;
        addedExperience = true;
      }
    }
  }

  // A nameless entry cannot be created (the name IS the entry). The model returns
  // a blank name when the answer was about an entry we already have — a deep-dive
  // — so skipping is right: the rest of this answer's updates still land, and the
  // analyzer re-asks if the section is genuinely still empty. Failing here instead
  // would throw away the whole answer. See `optionalName` in lib/ai/schemas.ts.
  for (const p of u.projects ?? []) {
    if (!p.name) continue;
    await store.createProject(profileId, {
      name: p.name,
      projectType: ov(p.projectType),
      organization: ov(p.organization),
      description: ov(p.description),
      responsibilities: p.responsibilities ?? [],
      outcomes: p.outcomes ?? [],
      tools: p.tools ?? [],
    });
  }
  for (const c of u.certifications ?? []) {
    if (!c.name) continue;
    await store.createCertification(profileId, {
      name: c.name,
      issuingOrganization: ov(c.issuingOrganization),
      issueDate: ov(c.issueDate),
    });
  }
  for (const l of u.languages ?? []) {
    await store.createLanguage(profileId, {
      name: l.name,
      speakingLevel: ov(l.speakingLevel),
      readingLevel: ov(l.readingLevel),
      writingLevel: ov(l.writingLevel),
    });
  }
  for (const a of u.achievements ?? []) {
    if (!a.title) continue;
    await store.createAchievement(profileId, {
      title: a.title,
      organization: ov(a.organization),
      date: ov(a.date),
      description: ov(a.description),
    });
  }

  return { targetExperienceId, addedExperience, addedEducation, affectedEntryId };
}

function emitSectionAnalytics(
  analytics: Analytics,
  input: ProcessAnswerInput,
  applied: AppliedChanges,
  userId?: string,
): void {
  if (input.questionId === "career_goal_target" || input.questionId === "career_goal_unknown") {
    analytics.track("career_goal_completed", { resumeProfileId: input.profileId }, userId);
  }
  if (input.questionId === "personal_contact" || input.questionId === "personal_name") {
    analytics.track("personal_information_completed", { resumeProfileId: input.profileId }, userId);
  }
  if (applied.addedEducation) {
    analytics.track("education_entry_added", { resumeProfileId: input.profileId }, userId);
  }
  if (applied.addedExperience) {
    analytics.track("experience_entry_added", { resumeProfileId: input.profileId }, userId);
  }
}

// ── Extract → store-input mappers (null → undefined so updates never clobber) ──
type Nullable<T> = T | null | undefined;
function ov<T>(v: Nullable<T>): T | undefined {
  return v == null ? undefined : v;
}

function mapEducation(e: NonNullable<AnswerNormalization["updates"]["educationEntries"]>[number]) {
  return {
    institution: ov(e.institution),
    credential: ov(e.credential),
    fieldOfStudy: ov(e.fieldOfStudy),
    location: ov(e.location),
    startDate: ov(e.startDate),
    endDate: ov(e.endDate),
    isCurrent: ov(e.isCurrent),
    relevantCoursework: e.relevantCoursework,
    source: "ai_extracted" as const,
  };
}

function mapExperience(e: NonNullable<AnswerNormalization["updates"]["experienceEntries"]>[number]) {
  return {
    // Included on updates too: re-answering (e.g. after "Volver") must be able to
    // correct the experience type, and omitting it was how an update could end up
    // with nothing to write at all.
    experienceType: ov(e.experienceType),
    title: ov(e.title),
    organization: ov(e.organization),
    location: ov(e.location),
    startDate: ov(e.startDate),
    endDate: ov(e.endDate),
    isCurrent: ov(e.isCurrent),
    rawDescription: ov(e.rawDescription),
    responsibilities: e.responsibilities,
    accomplishments: e.accomplishments,
    tools: e.tools,
    peopleServed: ov(e.peopleServed),
    metrics: e.metrics,
  };
}

function mapExperienceCreate(e: NonNullable<AnswerNormalization["updates"]["experienceEntries"]>[number]) {
  return {
    ...mapExperience(e),
    // A new entry always needs a concrete type; the spread must not reinstate
    // `undefined` over this default, so it comes last.
    experienceType: e.experienceType ?? ("other" as const),
  };
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}
