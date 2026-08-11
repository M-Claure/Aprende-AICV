/**
 * Source tracing (spec §12). Every generated line keeps a trace to the source
 * entries/fields it was built from. This module is also a SAFETY layer: it drops
 * any generated content that cannot be traced to a real confirmed entry, so the
 * model cannot smuggle invented facts into the resume via a bad entryId.
 */
import type { GeneratedBullet, GeneratedSkillGroup, SkillState } from "@/types";
import type { GeneratedBulletSchema } from "@/lib/ai/schemas";
import type { z } from "zod";

type RawBullet = z.infer<typeof GeneratedBulletSchema>;

/**
 * Validate a generated bullet against the set of known (confirmed) entry ids.
 * - Empty text → dropped.
 * - sourceEntryIds are filtered to known ids; if none remain, the fallback entry
 *   (the block this bullet belongs to) is used so the trace is never empty.
 */
export function traceBullet(
  bullet: RawBullet,
  knownEntryIds: ReadonlySet<string>,
  fallbackEntryId: string,
): GeneratedBullet | null {
  const text = bullet.text.trim();
  if (text.length === 0) return null;

  const validIds = bullet.sourceEntryIds.filter((id) => knownEntryIds.has(id));
  const sourceEntryIds = validIds.length > 0 ? validIds : [fallbackEntryId];

  return {
    text,
    sourceEntryIds,
    sourceFields: bullet.sourceFields.length > 0 ? bullet.sourceFields : ["general"],
  };
}

export function traceBullets(
  bullets: RawBullet[],
  knownEntryIds: ReadonlySet<string>,
  fallbackEntryId: string,
): GeneratedBullet[] {
  return bullets
    .map((b) => traceBullet(b, knownEntryIds, fallbackEntryId))
    .filter((b): b is GeneratedBullet => b !== null);
}

/**
 * Build skill groups from the model's grouping, resolving skill ids to the
 * actual confirmed skill names. Any id that is not a confirmed skill is dropped.
 * Confirmed skills the model failed to place land in an "Otras habilidades" group
 * so nothing confirmed is silently lost.
 */
export function buildSkillGroups(
  groups: Array<{ category: string; skillIds: string[] }>,
  confirmedSkills: SkillState[],
): GeneratedSkillGroup[] {
  const byId = new Map(confirmedSkills.map((s) => [s.id, s]));
  const placed = new Set<string>();
  const result: GeneratedSkillGroup[] = [];

  for (const g of groups) {
    const skills: string[] = [];
    const sourceSkillIds: string[] = [];
    for (const id of g.skillIds) {
      const skill = byId.get(id);
      if (!skill || placed.has(id)) continue;
      placed.add(id);
      skills.push(skill.name);
      sourceSkillIds.push(id);
    }
    if (skills.length > 0) result.push({ category: g.category, skills, sourceSkillIds });
  }

  const leftovers = confirmedSkills.filter((s) => !placed.has(s.id));
  if (leftovers.length > 0) {
    // Group leftovers by their own category rather than dumping them together.
    const byCategory = new Map<string, SkillState[]>();
    for (const s of leftovers) {
      const arr = byCategory.get(s.category) ?? [];
      arr.push(s);
      byCategory.set(s.category, arr);
    }
    for (const [category, arr] of byCategory) {
      const existing = result.find((r) => r.category === category);
      if (existing) {
        existing.skills.push(...arr.map((s) => s.name));
        existing.sourceSkillIds.push(...arr.map((s) => s.id));
      } else {
        result.push({
          category,
          skills: arr.map((s) => s.name),
          sourceSkillIds: arr.map((s) => s.id),
        });
      }
    }
  }

  return result;
}
