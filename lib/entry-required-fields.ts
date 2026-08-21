/**
 * Which fields an education or experience entry must have — ONE definition, used
 * by the card that draws the red asterisk AND by the screen that decides whether
 * the person may continue.
 *
 * Why this module exists: the asterisks originally only gated each card's
 * "Guardar". Someone could leave a card half-empty, never press Guardar, and press
 * the big button anyway — so the asterisks announced a rule nothing enforced. The
 * same lesson `lib/entry-blankness.ts` records: two copies of a rule let the screen
 * say a card is fine while something else disagrees.
 *
 * ── Two shapes, one rule ─────────────────────────────────────────────────────
 * The card holds FORM state (month and year as separate dropdowns, never null) and
 * the review screen holds a PERSISTED entry (dates as free text, everything
 * nullable). Rather than write the rule twice, both are normalized to
 * `…RequiredValues` first, and the adapters below own the two decisions that
 * differ:
 *
 *   - a date counts when its YEAR is known (the month stays optional — plenty of
 *     people remember the year but not the month, and a bare year still orders the
 *     résumé correctly);
 *   - "what you did" counts when there is free text OR any responsibility, which is
 *     exactly the fallback the card uses to fill that box in the first place.
 *
 * Pure module: imports only `experience-dates` (itself pure), so it runs in the
 * browser and is unit-testable with plain objects.
 */
import { parseExperienceDate } from "./experience-dates";

export type ExperienceField = "title" | "organization" | "startDate" | "endDate" | "description";
/**
 * Note what is NOT here: `fieldOfStudy`.
 *
 * Someone whose highest level is primaria or secundaria has no área de estudio, and
 * the funnel never asks for one (its education questions capture the level, the
 * institution and the year). Requiring it would leave that person unable to continue
 * unless they typed something untrue — a hard stop on exactly the user this product
 * exists for, in exchange for a field the résumé can do without. It keeps its box on
 * the Review screen, without an asterisk.
 */
export type EducationField = "institution" | "credential" | "endDate";

/** Exactly the captions the cards show, so a warning names what the eye is looking for. */
export const EXPERIENCE_FIELD_LABEL: Record<ExperienceField, string> = {
  title: "Puesto / rol",
  organization: "Organización",
  startDate: "Empezó en",
  endDate: "Terminó en",
  description: "¿Qué hacías?",
};

export const EDUCATION_FIELD_LABEL: Record<EducationField, string> = {
  institution: "Institución",
  credential: "Título / nivel",
  endDate: "Año de fin",
};

export interface ExperienceRequiredValues {
  title: string;
  organization: string;
  /** Year only — see the note above. */
  startYear: string;
  endYear: string;
  isCurrent: boolean;
  description: string;
}

export interface EducationRequiredValues {
  institution: string;
  credential: string;
  endDate: string;
}

const blank = (v: string): boolean => v.trim().length === 0;

/**
 * The experience fields still to fill, in the order the card shows them.
 *
 * `isCurrent` is the one exemption: "Sigo en esta experiencia" IS the end date, and
 * checking it clears the dropdowns, so asking for one anyway would be unanswerable.
 */
export function missingExperienceFields(v: ExperienceRequiredValues): ExperienceField[] {
  const missing: ExperienceField[] = [];
  if (blank(v.title)) missing.push("title");
  if (blank(v.organization)) missing.push("organization");
  if (blank(v.startYear)) missing.push("startDate");
  if (!v.isCurrent && blank(v.endYear)) missing.push("endDate");
  if (blank(v.description)) missing.push("description");
  return missing;
}

/** The education fields still to fill, in the order the card shows them. */
export function missingEducationFields(v: EducationRequiredValues): EducationField[] {
  const missing: EducationField[] = [];
  if (blank(v.institution)) missing.push("institution");
  if (blank(v.credential)) missing.push("credential");
  if (blank(v.endDate)) missing.push("endDate");
  return missing;
}

/** A stored entry → the values the rule reads. */
export function experienceRequiredValues(e: {
  title: string | null;
  organization: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  rawDescription: string | null;
  responsibilities: readonly string[];
}): ExperienceRequiredValues {
  return {
    title: e.title ?? "",
    organization: e.organization ?? "",
    startYear: parseExperienceDate(e.startDate).year,
    endYear: parseExperienceDate(e.endDate).year,
    isCurrent: e.isCurrent,
    // Same fallback the card fills its box with: an entry captured as a list of
    // responsibilities has said what the person did, even with no free text.
    description: e.rawDescription ?? e.responsibilities.join(", "),
  };
}

export function educationRequiredValues(e: {
  institution: string | null;
  credential: string | null;
  endDate: string | null;
}): EducationRequiredValues {
  return {
    institution: e.institution ?? "",
    credential: e.credential ?? "",
    endDate: e.endDate ?? "",
  };
}

/**
 * What to call an entry in a warning.
 *
 * Never the id: «Cuéntame más sobre «7f3c…»» is the exact failure the funnel
 * already learned from. An entry with nothing in it gets a plain Spanish
 * placeholder instead.
 */
export function experienceEntryName(e: { title: string | null; organization: string | null }): string {
  return e.title?.trim() || e.organization?.trim() || "Experiencia sin nombre";
}

export function educationEntryName(e: {
  credential: string | null;
  institution: string | null;
}): string {
  return e.credential?.trim() || e.institution?.trim() || "Estudio sin nombre";
}

/** One entry's outstanding fields, ready to render. */
export interface IncompleteEntry {
  readonly id: string;
  readonly section: "education" | "experience";
  readonly name: string;
  /** Spanish labels, in card order. */
  readonly missing: string[];
}

/**
 * Every entry that still has an empty required field.
 *
 * This is what gates continuing. It reads PERSISTED entries on purpose: a card the
 * person filled in but never saved is not saved, and the résumé is generated from
 * what is stored — so the honest answer is "still missing", and the warning tells
 * them to press Guardar.
 */
export function incompleteEntries(state: {
  education: readonly {
    id: string;
    institution: string | null;
    credential: string | null;
    endDate: string | null;
  }[];
  experience: readonly {
    id: string;
    title: string | null;
    organization: string | null;
    startDate: string | null;
    endDate: string | null;
    isCurrent: boolean;
    rawDescription: string | null;
    responsibilities: readonly string[];
  }[];
}): IncompleteEntry[] {
  const out: IncompleteEntry[] = [];

  for (const e of state.education) {
    const missing = missingEducationFields(educationRequiredValues(e));
    if (missing.length > 0) {
      out.push({
        id: e.id,
        section: "education",
        name: educationEntryName(e),
        missing: missing.map((f) => EDUCATION_FIELD_LABEL[f]),
      });
    }
  }

  for (const e of state.experience) {
    const missing = missingExperienceFields(experienceRequiredValues(e));
    if (missing.length > 0) {
      out.push({
        id: e.id,
        section: "experience",
        name: experienceEntryName(e),
        missing: missing.map((f) => EXPERIENCE_FIELD_LABEL[f]),
      });
    }
  }

  return out;
}
