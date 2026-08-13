import type { ExperienceType } from "@/types";

/**
 * Spanish labels for each experience type, and helpers shared by the funnel UI,
 * the question engine, and the answer pipeline. Pure data (imports only types),
 * so it is safe on both client and server.
 *
 * The order here is the order shown in the "¿qué tipo y cuántas?" counter step.
 * `self_employment` / `other` are intentionally omitted from the counter list
 * (still labeled below for entries created elsewhere).
 */
export const EXPERIENCE_TYPE_OPTIONS: { type: ExperienceType; label: string }[] = [
  { type: "formal_employment", label: "Empleo formal" },
  { type: "informal_work", label: "Trabajo informal" },
  { type: "freelance", label: "Freelance / independiente" },
  { type: "business_owner", label: "Negocio propio" },
  { type: "family_business", label: "Negocio familiar" },
  { type: "volunteering", label: "Voluntariado" },
  { type: "caregiving", label: "Cuidado de personas" },
  { type: "internship", label: "Prácticas / pasantía" },
  { type: "school_project", label: "Proyecto escolar" },
  { type: "personal_project", label: "Proyecto personal" },
];

const LABELS: Record<ExperienceType, string> = {
  formal_employment: "empleo formal",
  self_employment: "trabajo por cuenta propia",
  business_owner: "negocio propio",
  freelance: "trabajo freelance",
  informal_work: "trabajo informal",
  family_business: "negocio familiar",
  volunteering: "voluntariado",
  internship: "práctica / pasantía",
  school_project: "proyecto escolar",
  caregiving: "cuidado de personas",
  personal_project: "proyecto personal",
  other: "experiencia",
};

/** Human, lowercase label for a type (used mid-sentence, e.g. "tu voluntariado"). */
export function labelForType(type: ExperienceType): string {
  return LABELS[type] ?? "experiencia";
}

/**
 * An entry is "undescribed" when the user hasn't yet said what it was — i.e. it
 * has neither a free-text description nor any responsibilities. The counter step
 * creates entries in exactly this state, and the describe step fills them one by
 * one. Kept in sync with the completeness engine's own "missing responsibilities"
 * check so readiness and the ask-loop agree.
 */
export function isExperienceUndescribed(e: {
  responsibilities: readonly string[];
  rawDescription: string | null;
}): boolean {
  return e.responsibilities.length === 0 && !(e.rawDescription && e.rawDescription.trim().length > 0);
}

/**
 * An entry is "undated" when nothing places it in time — no start, no end, and not
 * marked current. The résumé orders experience newest-first, so an undated entry
 * can only sink to the bottom in capture order.
 *
 * Shared deliberately: the question catalog uses it to decide WHICH experience to
 * ask about, and the answer pipeline uses it to decide which entry that answer
 * belongs to. Two copies of this predicate would let the question name one
 * experience while the answer landed on another.
 */
export function isExperienceUndated(e: {
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
}): boolean {
  const filled = (v: string | null) => typeof v === "string" && v.trim().length > 0;
  return !filled(e.startDate) && !filled(e.endDate) && !e.isCurrent;
}
