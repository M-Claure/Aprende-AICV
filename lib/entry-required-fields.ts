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
 * ── The rule may only ask for what the funnel can produce ────────────────────
 * Every field on this list has to be reachable by someone who answered the funnel
 * honestly, because this is the last screen before the résumé and there is no way
 * back past it. Two exemptions exist for that reason and neither is cosmetic:
 * `fieldOfStudy` is absent entirely, and title/organization gate as a PAIR rather
 * than individually. Before adding a field here, check that the catalog actually
 * asks for it — and that a caregiver, a market vendor and someone whose highest
 * level is primaria can all answer it truthfully.
 *
 * Pure module: imports only `experience-dates` (itself pure), so it runs in the
 * browser and is unit-testable with plain objects.
 */
import { effectiveExperienceDates } from "./experience-dates";

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

/**
 * How the warning names one entry's outstanding fields.
 *
 * `title` and `organization` collapse into a single "o" line: they are satisfied by
 * either one, and listing both would tell the person two things are needed when one
 * is. Everything else is named exactly as its box is captioned.
 */
export function describeMissingExperienceFields(
  fields: readonly ExperienceField[],
): string[] {
  const named: string[] = [];
  // The pair is pushed together or not at all, so one check covers both.
  if (fields.includes("title") || fields.includes("organization")) {
    named.push(`${EXPERIENCE_FIELD_LABEL.title} u ${EXPERIENCE_FIELD_LABEL.organization}`);
  }
  for (const f of fields) {
    if (f === "title" || f === "organization") continue;
    named.push(EXPERIENCE_FIELD_LABEL[f]);
  }
  return named;
}

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
  /*
   * An entry needs a NAME, not both names — filling EITHER is enough, exactly the
   * rule "correo o teléfono" follows on the same screen.
   *
   * Requiring both was a hard stop on this product's core user. The funnel asks for
   * neither (`grep title lib/question-engine/question-catalog.ts` finds nothing):
   * they exist only when the model infers them from the description, and they are
   * explicitly null on the counter path and whenever the spend cap degrades capture
   * to the deterministic provider. So somebody who cared for their grandmother at
   * home had no truthful "Organización" to type and could not continue — the same
   * argument that keeps `fieldOfStudy` off this list.
   *
   * What the pair still guarantees is the thing that actually matters: the entry has
   * a human name, so the improvement loop never has to say «Cuéntame más sobre
   * «7f3c…»». `experienceEntryName` reads the same two fields in the same order, and
   * the résumé renderer falls back to the experience TYPE for a heading, so neither
   * field is required to produce a good résumé.
   *
   * Reported together and satisfied together, which is what lets the card outline
   * both boxes only once both are empty.
   */
  if (blank(v.title) && blank(v.organization)) {
    missing.push("title", "organization");
  }
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
  // Read through `effectiveExperienceDates`, NOT field by field: the funnel writes
  // its whole date answer to `startDate`, so "de marzo 2020 a la actualidad" left
  // `endDate` null and this rule reported a missing "Terminó en" for every
  // experience the funnel had ever captured — an answer the person had already
  // given. The Review card reads the same way, so the asterisk and the dropdown
  // agree. See `lib/experience-dates.ts`.
  const dates = effectiveExperienceDates(e);
  return {
    title: e.title ?? "",
    organization: e.organization ?? "",
    startYear: dates.start.year,
    endYear: dates.end.year,
    isCurrent: dates.isCurrent,
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
        missing: describeMissingExperienceFields(missing),
      });
    }
  }

  return out;
}
