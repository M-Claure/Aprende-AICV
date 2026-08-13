/**
 * Month/year handling for experience dates.
 *
 * Dates in this product are stored as FREE TEXT, because the funnel asks for "una
 * fecha aproximada" and keeps whatever the person said ("marzo 2020", "2019", "de
 * junio 2021 a la actualidad"). The Review screen offers month + year dropdowns
 * instead — easier than typing a format, and it produces exactly the shape
 * `lib/resume/experience-order.ts` parses, so a date picked here always orders
 * correctly on the résumé.
 *
 * This module owns the canonical Spanish month names; the ordering parser builds
 * its lookup from the same list, so the two can never drift apart. Pure (no
 * imports, no I/O) so the browser and the server share it.
 */

/** Canonical Spanish month names, January first. Index 0 is enero (month 1). */
export const MONTHS_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/** Dropdown options: value is the month number as a string, label is capitalized. */
export const MONTH_OPTIONS: ReadonlyArray<{ value: string; label: string }> = MONTHS_ES.map(
  (name, i) => ({
    value: String(i + 1),
    label: name.charAt(0).toLocaleUpperCase("es") + name.slice(1),
  }),
);

/** How far back the year dropdown reaches. A working life, not a calendar. */
const YEARS_BACK = 60;

/**
 * Year options, newest first — most experiences are recent, so the useful values
 * are at the top of the list rather than 60 scrolls down. Takes the current year
 * as an argument so the module stays pure and testable.
 */
export function yearOptions(currentYear: number): string[] {
  return Array.from({ length: YEARS_BACK + 1 }, (_, i) => String(currentYear - i));
}

/**
 * Builds the stored string from the two dropdowns: "marzo 2020", or just "2019"
 * when the person remembers the year but not the month. A month with no year is
 * not a date anyone can order by, so it yields "".
 */
export function formatExperienceDate(month: string, year: string): string {
  const y = year.trim();
  if (!y) return "";
  const monthIndex = Number(month) - 1;
  const name = MONTHS_ES[monthIndex];
  return name ? `${name} ${y}` : y;
}

/**
 * Reads a stored free-text date back into the two dropdowns, so opening Review
 * shows what was captured instead of blank selects.
 *
 * Deliberately forgiving about what it accepts, because the value may have been
 * typed by a person in the funnel rather than picked here: it takes the FIRST
 * month name and the FIRST 4-digit year it finds, in any order, and ignores the
 * rest ("de marzo 2020 a la actualidad" → marzo / 2020). Anything it cannot read
 * comes back empty, which leaves the field blank rather than guessing.
 */
export function parseExperienceDate(text: string | null | undefined): {
  month: string;
  year: string;
} {
  if (!text) return { month: "", year: "" };
  const lower = text.toLocaleLowerCase("es");
  const monthIndex = MONTHS_ES.findIndex((name) => lower.includes(name));
  const year = /\b(19\d{2}|20\d{2}|21\d{2})\b/.exec(lower)?.[1] ?? "";
  return { month: monthIndex >= 0 ? String(monthIndex + 1) : "", year };
}

/** Wording the renderer and the funnel both use for an ongoing experience. */
export const CURRENT_DATE_LABEL = "Actualidad";
