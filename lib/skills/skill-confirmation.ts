/**
 * Skill confirmation lifecycle (spec §10). The user is the only actor that can
 * move a skill out of `suggested`. A user-entered skill is created directly as
 * `confirmed`; an inferred skill must be confirmed/edited/rejected explicitly.
 */
import type { Skill } from "@/types";
import { Errors } from "@/lib/errors";
import type { Store } from "@/lib/repositories/store";

export async function confirmSkill(store: Store, skillId: string): Promise<Skill> {
  const skill = await store.getSkill(skillId);
  if (!skill) throw Errors.notFound("Habilidad no encontrada");
  return store.updateSkill(skillId, { status: "confirmed" });
}

export async function rejectSkill(store: Store, skillId: string): Promise<Skill> {
  const skill = await store.getSkill(skillId);
  if (!skill) throw Errors.notFound("Habilidad no encontrada");
  return store.updateSkill(skillId, { status: "rejected" });
}

export interface SkillEdit {
  name?: string;
  category?: string;
  proficiency?: Skill["proficiency"];
}

/** Editing a skill counts as user confirmation → status becomes `edited`. */
export async function editSkill(store: Store, skillId: string, edit: SkillEdit): Promise<Skill> {
  const skill = await store.getSkill(skillId);
  if (!skill) throw Errors.notFound("Habilidad no encontrada");
  return store.updateSkill(skillId, {
    name: edit.name,
    category: edit.category,
    proficiency: edit.proficiency,
    status: "edited",
  });
}

/** Add a skill the user typed themselves → immediately confirmed. */
export async function addUserSkill(
  store: Store,
  profileId: string,
  input: { name: string; category?: string; proficiency?: Skill["proficiency"] },
): Promise<Skill> {
  const existing = await store.findSkillByName(profileId, input.name);
  if (existing) {
    // Promote an existing suggestion instead of creating a duplicate.
    return store.updateSkill(existing.id, {
      status: "confirmed",
      category: input.category ?? existing.category,
      proficiency: input.proficiency ?? existing.proficiency,
    });
  }
  return store.createSkill(profileId, {
    name: input.name,
    category: input.category ?? "general",
    proficiency: input.proficiency ?? null,
    origin: "user_entered",
    status: "confirmed",
  });
}

/** Batch confirm/reject used by the skill_confirmation step of the pipeline. */
export async function applySkillDecisions(
  store: Store,
  decisions: { confirm?: string[]; reject?: string[]; edit?: Array<{ id: string } & SkillEdit> },
): Promise<Skill[]> {
  const results: Skill[] = [];
  for (const id of decisions.confirm ?? []) results.push(await confirmSkill(store, id));
  for (const id of decisions.reject ?? []) results.push(await rejectSkill(store, id));
  for (const e of decisions.edit ?? []) {
    const { id, ...edit } = e;
    results.push(await editSkill(store, id, edit));
  }
  return results;
}
