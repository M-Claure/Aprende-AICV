/**
 * Skill inference (spec §10). Turns evidence-backed model suggestions into
 * persisted `suggested` skills. Invariants enforced HERE, not just in prompts:
 *   - a suggestion must carry evidence (dropped otherwise),
 *   - inferred skills are ALWAYS created with status `suggested` (never confirmed),
 *   - prohibited inferences (leadership/management/fluency without evidence) are
 *     filtered out,
 *   - duplicates (any status) are never re-suggested.
 */
import type { ResumeProfileState, Skill } from "@/types";
import type { AIProvider, SuggestSkillsParams } from "@/lib/ai";
import type { SuggestedSkillPayload } from "@/lib/ai/schemas";
import type { Store } from "@/lib/repositories/store";

/** Terms that require explicit supporting evidence before they may be suggested. */
const GUARDED_TERMS = /(liderazgo|lider|gerenci|gesti[oó]n de equipo|supervis|jefatur|direcci[oó]n)/i;
const EVIDENCE_OF_LEADERSHIP = /(supervis|coordin[eé]|lider[eé]|a cargo|dirig[íi]|gestion[eé]|equipo de)/i;
const FLUENCY_TERMS = /(fluid|nativ|biling|dominio del idioma)/i;

export function isProhibitedSuggestion(s: SuggestedSkillPayload): boolean {
  if (!s.evidence || s.evidence.trim().length === 0) return true;
  if (GUARDED_TERMS.test(s.name) && !EVIDENCE_OF_LEADERSHIP.test(s.evidence)) return true;
  // Language fluency must be confirmed, never inferred as a skill.
  if (FLUENCY_TERMS.test(s.name)) return true;
  return false;
}

/** Attribute a suggestion to the source experience entry whose text it cites. */
function attributeSource(
  suggestion: SuggestedSkillPayload,
  state: ResumeProfileState,
  focusIds?: string[],
): string | null {
  const pool = focusIds
    ? state.experience.filter((e) => focusIds.includes(e.id))
    : state.experience;
  const evidence = suggestion.evidence.toLowerCase();
  const match = pool.find((e) =>
    [...e.responsibilities, ...e.accomplishments, e.rawDescription ?? ""].some(
      (t) => t.trim().length > 3 && evidence.includes(t.toLowerCase().slice(0, 20)),
    ),
  );
  return match?.id ?? pool[0]?.id ?? null;
}

export async function inferAndPersistSkills(
  store: Store,
  provider: AIProvider,
  state: ResumeProfileState,
  opts: { focusExperienceIds?: string[] } = {},
): Promise<Skill[]> {
  const existing = await store.listSkills(state.resumeProfileId);
  const excludeSkillNames = existing.map((s) => s.name);

  const params: SuggestSkillsParams = {
    state,
    focusExperienceIds: opts.focusExperienceIds,
    excludeSkillNames,
  };
  const suggestions = await provider.suggestSkills(params);

  const excludeLower = new Set(excludeSkillNames.map((n) => n.toLowerCase()));
  const created: Skill[] = [];

  for (const suggestion of suggestions) {
    const key = suggestion.name.toLowerCase();
    if (excludeLower.has(key)) continue; // never re-suggest
    if (isProhibitedSuggestion(suggestion)) continue; // §10 guardrails
    excludeLower.add(key);

    try {
      const skill = await store.createSkill(state.resumeProfileId, {
        name: suggestion.name,
        category: suggestion.category,
        evidence: suggestion.evidence,
        origin: "experience_inference",
        sourceEntryId: attributeSource(suggestion, state, opts.focusExperienceIds),
        status: "suggested", // invariant: inferred skills are never auto-confirmed
      });
      created.push(skill);
    } catch {
      // Duplicate (unique index / conflict) — skip silently.
    }
  }

  return created;
}
