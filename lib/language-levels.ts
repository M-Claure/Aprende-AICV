/**
 * Spanish labels for a language level.
 *
 * Shared deliberately: the résumé prints one of these strings and the Review screen
 * offers the same list in a dropdown. Two copies would let the page say "Intermedio"
 * while the PDF said something else — and the whole point of the Review screen is
 * that what you see is what gets printed.
 *
 * Pure data (imports only types), so both the server-side generator and a Client
 * Component can read it.
 */
import { LANGUAGE_LEVELS, type LanguageLevel } from "@/types";

const LABELS: Record<LanguageLevel, string> = {
  basico: "Básico",
  intermedio: "Intermedio",
  avanzado: "Avanzado",
  nativo: "Nativo",
};

/** Ordered lowest → highest, which is the order the dropdown shows. */
export const LANGUAGE_LEVEL_OPTIONS: { level: LanguageLevel; label: string }[] =
  LANGUAGE_LEVELS.map((level) => ({ level, label: LABELS[level] }));

/** The label for a level, or the raw value if an unknown one ever reaches here. */
export function labelForLanguageLevel(level: string): string {
  return LABELS[level as LanguageLevel] ?? level;
}
