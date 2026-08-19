/**
 * Zod schemas for API request bodies. Every route validates its input with one
 * of these before touching a service — malformed requests become a consistent
 * 422 validation_error (see lib/http.ts).
 */
import { z } from "zod";
import {
  CONTACT_FIELD_CHAR_LIMITS,
  ENTRY_TEXT_CHAR_LIMIT,
  LIST_ITEM_CHAR_LIMIT,
  LIST_MAX_ITEMS,
  REVIEW_FIELD_CHAR_LIMITS as R,
  answerCharLimitForQuestion,
  tooLongMessage,
} from "@/lib/answer-limits";
import { isEmail, isPhone } from "@/lib/personal-contact";
import {
  EXPERIENCE_TYPES,
  LANGUAGE_LEVELS,
  PROFICIENCY_LEVELS,
  PROJECT_TYPES,
  RESUME_SECTIONS,
} from "@/types/domain";

const section = z.enum(RESUME_SECTIONS);
const nonEmpty = z.string().trim().min(1);
// Narrative entry text and bullet lists are bounded for the same reason answers
// are: every generation/analysis/proofread prompt re-sends them. See
// lib/answer-limits.ts.
const optStr = z.string().trim().max(ENTRY_TEXT_CHAR_LIMIT).optional();
const strArray = z
  .array(z.string().trim().min(1).max(LIST_ITEM_CHAR_LIMIT))
  .max(LIST_MAX_ITEMS);

export const CreateProfileBody = z
  .object({
    targetRole: z.string().trim().max(200).optional(),
    careerGoal: z.string().trim().max(500).optional(),
    location: z.string().trim().max(200).optional(),
    // Name + at least one contact channel are REQUIRED to start the builder, so a
    // profile is never persisted for someone we have no way to reach. Enforced
    // here rather than only in the UI: the route cannot reach a write without it.
    // Lengths match CONTACT_FIELD_CHAR_LIMITS, which the form counts against.
    fullName: z
      .string()
      .trim()
      .min(1, { message: "Escribe tu nombre" })
      .max(CONTACT_FIELD_CHAR_LIMITS.fullName),
    // Asked as two separate fields, so each is validated whole instead of being
    // guessed out of one combined string. Either one alone is enough.
    email: z.string().trim().max(CONTACT_FIELD_CHAR_LIMITS.email).optional(),
    phone: z.string().trim().max(CONTACT_FIELD_CHAR_LIMITS.phone).optional(),
    // Terms & conditions consent is REQUIRED to start the builder — enforced here
    // (not just in the UI) so a profile can never be created without acceptance.
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: "Debes aceptar los términos y condiciones para continuar" }),
    }),
  })
  .superRefine((body, ctx) => {
    // `.trim()` already normalised these; "" means the field was left blank.
    const email = body.email ?? "";
    const phone = body.phone ?? "";

    if (!email && !phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "Escribe tu correo electrónico o tu teléfono. Con uno de los dos basta",
      });
      return;
    }
    if (email && !isEmail(email)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "Escribe un correo electrónico válido, por ejemplo maria@correo.com",
      });
    }
    if (phone && !isPhone(phone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phone"],
        message: "Escribe un teléfono válido, por ejemplo 555 123 4567",
      });
    }
  });

export const PatchProfileBody = z.object({
  targetRole: z.string().trim().max(200).nullable().optional(),
  careerGoal: z.string().trim().max(500).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
});

const SkillEditBody = z.object({
  id: nonEmpty,
  name: z.string().trim().max(80).optional(),
  category: z.string().trim().max(60).optional(),
  proficiency: z.enum(PROFICIENCY_LEVELS).nullable().optional(),
});

export const AnswerBody = z
  .object({
    questionId: nonEmpty.max(120),
    section,
    // Hard ceiling only; the real per-question limit is applied in superRefine
    // below, resolved from the catalog. Kept generous here so an over-limit
    // answer produces the specific "muy larga" message rather than this one.
    rawAnswer: z.string().max(5000).optional(),
    skipped: z.boolean().optional().default(false),
    skillDecisions: z
      .object({
        confirm: z.array(nonEmpty).max(100).optional(),
        reject: z.array(nonEmpty).max(100).optional(),
        edit: z.array(SkillEditBody).max(100).optional(),
      })
      .optional(),
    timeSpentMs: z.number().int().nonnegative().max(86_400_000).optional(),
    deviceCategory: z.enum(["mobile", "tablet", "desktop"]).optional(),
    // Overwrite this existing entry instead of creating a new one (back-edit).
    targetEntryId: z.string().max(120).optional(),
    // Create a new entry rather than filling one still awaiting a description
    // ("Agregar otra experiencia"). The cap is still enforced server-side.
    forceNewEntry: z.boolean().optional(),
  })
  .refine((b) => b.skipped || b.rawAnswer !== undefined || b.skillDecisions !== undefined, {
    message: "Se requiere una respuesta, decisiones de habilidades, o skipped=true",
  })
  .superRefine((b, ctx) => {
    // Bound what reaches the model. The limit comes from the catalog entry for
    // this questionId — never from the request — so a crafted body cannot raise
    // its own ceiling. See lib/answer-limits.ts for the cost rationale.
    if (b.rawAnswer === undefined) return;
    const limit = answerCharLimitForQuestion(b.questionId);
    if (b.rawAnswer.trim().length > limit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rawAnswer"],
        message: tooLongMessage(limit),
      });
    }
  });

export const CreateEducationBody = z.object({
  institution: z.string().trim().max(R.institution).optional(),
  credential: z.string().trim().max(R.credential).optional(),
  fieldOfStudy: z.string().trim().max(R.fieldOfStudy).optional(),
  location: z.string().trim().max(R.location).optional(),
  startDate: z.string().trim().max(R.date).optional(),
  endDate: z.string().trim().max(R.date).optional(),
  isCurrent: z.boolean().optional(),
  relevantCoursework: strArray.optional(),
  achievements: strArray.optional(),
});
export const UpdateEducationBody = CreateEducationBody.extend({
  confirmationStatus: z.enum(["confirmed", "needs_review", "edited", "rejected"]).optional(),
});

export const CreateExperienceBody = z.object({
  experienceType: z.enum(EXPERIENCE_TYPES),
  title: z.string().trim().max(R.title).optional(),
  organization: z.string().trim().max(R.organization).optional(),
  location: z.string().trim().max(R.location).optional(),
  startDate: z.string().trim().max(R.date).optional(),
  endDate: z.string().trim().max(R.date).optional(),
  isCurrent: z.boolean().optional(),
  rawDescription: optStr,
  responsibilities: strArray.optional(),
  accomplishments: strArray.optional(),
  tools: strArray.optional(),
  peopleServed: z.string().trim().max(R.peopleServed).optional(),
  metrics: strArray.optional(),
});
export const UpdateExperienceBody = CreateExperienceBody.partial().extend({
  confirmationStatus: z.enum(["confirmed", "needs_review", "edited", "rejected"]).optional(),
});

export const CreateSkillBody = z.object({
  name: nonEmpty.max(80),
  category: z.string().trim().max(60).optional(),
  proficiency: z.enum(PROFICIENCY_LEVELS).nullable().optional(),
});
export const EditSkillBody = z.object({
  name: z.string().trim().max(80).optional(),
  category: z.string().trim().max(60).optional(),
  proficiency: z.enum(PROFICIENCY_LEVELS).nullable().optional(),
});

export const CreateLanguageBody = z.object({
  name: nonEmpty.max(80),
  speakingLevel: z.enum(LANGUAGE_LEVELS).nullable().optional(),
  readingLevel: z.enum(LANGUAGE_LEVELS).nullable().optional(),
  writingLevel: z.enum(LANGUAGE_LEVELS).nullable().optional(),
});

export const CreateProjectBody = z.object({
  name: nonEmpty.max(200),
  projectType: z.enum(PROJECT_TYPES).nullable().optional(),
  organization: z.string().trim().max(200).optional(),
  description: optStr,
  responsibilities: strArray.optional(),
  outcomes: strArray.optional(),
  tools: strArray.optional(),
});

export const PatchPersonalInfoBody = z.object({
  firstName: z.string().trim().max(R.firstName).nullable().optional(),
  lastName: z.string().trim().max(R.lastName).nullable().optional(),
  city: z.string().trim().max(R.city).nullable().optional(),
  state: z.string().trim().max(R.state).nullable().optional(),
  country: z.string().trim().max(R.country).nullable().optional(),
  phone: z.string().trim().max(R.phone).nullable().optional(),
  email: z.string().trim().max(R.email).nullable().optional(),
  linkedInUrl: z.string().trim().max(R.linkedInUrl).nullable().optional(),
  portfolioUrl: z.string().trim().max(R.portfolioUrl).nullable().optional(),
});

export const AddSkillsBody = z.object({
  names: z.array(nonEmpty.max(R.skillName)).min(1).max(30),
});

export const SetInterestsBody = z.object({
  interests: z.array(z.string().trim().min(1).max(R.interest)).max(30),
});

/** Free-text interests answer → the server extracts genuine interests (ignoring
 * negations) and appends them to the profile. */
export const ExtractInterestsBody = z.object({
  rawAnswer: z.string().trim().max(2000),
});

export const EnrichEntryBody = z.object({
  entryType: z.enum(["experience", "project"]),
  entryId: nonEmpty.max(120),
  rawAnswer: nonEmpty.max(5000),
});

export const RegenerateSectionBody = z.object({
  section: z.enum(["professional_summary", "experience", "education", "projects", "skills"]),
});

export type AnswerBodyInput = z.infer<typeof AnswerBody>;

/**
 * One improvement-round question/answer. `question` is the text the user was
 * shown, which only the client has — the analyzer's output is not persisted.
 */
export const RecordIterationAnswerBody = z.object({
  questionId: z.string().min(1).max(120),
  question: z.string().min(1).max(2000),
  answer: z.string().max(8000).nullish(),
});
