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
 * back past it. Concretely: a field belongs here only if the catalog asks for it
 * WITHOUT offering "Omitir". That is what separates the two sections — every
 * experience question is `allowSkip: false`, every education question is
 * `allowSkip: true` — and it is why the exemptions below are structural rather than
 * cosmetic: `fieldOfStudy` and education's `endDate` are absent entirely, and both
 * "what is this entry called" pairs (title/organization, credential/institution)
 * gate as a PAIR rather than individually.
 *
 * Before adding a field here, check the catalog for its `allowSkip`, and check that
 * a caregiver, a market vendor and someone whose highest level is primaria can all
 * answer it truthfully. If the answer is "the funnel should insist", change the
 * catalog first and this file second — never only this file.
 *
 * Pure module: imports only `experience-dates` (itself pure), so it runs in the
 * browser and is unit-testable with plain objects.
 */
import { effectiveExperienceDates } from "./experience-dates";

export type ExperienceField = "title" | "organization" | "startDate" | "endDate" | "description";
/**
 * Education asks for a NAME and nothing else, because a name is the only thing its
 * funnel questions guarantee.
 *
 * Every education question in the catalog is `allowSkip: true` — `education_highest`
 * ("No estudié"), `education_details` and `education_dates` all render an "Omitir"
 * button. Every experience question is `allowSkip: false`. So the two sections can
 * not have the same rule: what the funnel lets you skip, this screen must not then
 * demand, or the product offers a choice and punishes it one screen later with no
 * way back.
 *
 * Note what is NOT here:
 *   - `fieldOfStudy` — someone whose highest level is primaria or secundaria has no
 *     área de estudio, and nothing ever asks for one;
 *   - `endDate` — `education_dates` is skippable and says "una fecha aproximada está
 *     bien"; a person who finished primaria decades ago may simply not remember the
 *     year, and a résumé prints education without one perfectly well;
 *   - `institution` on its own — `education_details` is skippable too, so it pairs
 *     with `credential` instead (either one names the entry).
 *
 * All three keep their box on the Review screen; `endDate` and `fieldOfStudy` keep it
 * without an asterisk. To make the year mandatory, the change belongs in the CATALOG
 * (drop its `allowSkip`) and then here — in that order, never only here.
 */
export type EducationField = "institution" | "credential";

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
};

/**
 * How the warning names an education entry's outstanding fields — the same "o" line
 * as experience, for the same reason: either field satisfies the rule, so naming
 * both would say two things are needed when one is.
 */
export function describeMissingEducationFields(
  fields: readonly EducationField[],
): string[] {
  if (fields.length === 0) return [];
  return [`${EDUCATION_FIELD_LABEL.credential} u ${EDUCATION_FIELD_LABEL.institution}`];
}

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

/**
 * The education fields still to fill, in the order the card shows them.
 *
 * One rule only: the entry needs a name. `credential` or `institution` — either is
 * enough, so they are reported together and satisfied together, which is what lets
 * the card outline both boxes only once both are empty. See the type's note above
 * for why nothing else is required.
 */
export function missingEducationFields(v: EducationRequiredValues): EducationField[] {
  if (blank(v.institution) && blank(v.credential)) return ["institution", "credential"];
  return [];
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
}): EducationRequiredValues {
  return {
    institution: e.institution ?? "",
    credential: e.credential ?? "",
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
        missing: describeMissingEducationFields(missing),
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
