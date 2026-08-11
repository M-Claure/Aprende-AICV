/**
 * Enriches ONE specific experience/project entry with a deep-dive answer.
 *
 * Used by the improvement loop: when the user answers a personalized question
 * about a particular entry (e.g. "which tools did you use for the Monte Carlo
 * simulator?"), we extract structured detail and APPEND it to that entry (never
 * overwrite), preserving the original wording. The next generation polishes it.
 */
import type { AIProvider } from "@/lib/ai";
import { Errors } from "@/lib/errors";
import type { Store } from "@/lib/repositories/store";
import { assembleProfileState } from "@/lib/profile-state";
import { inferAndPersistSkills } from "@/lib/skills/skill-inference";

export type EntryType = "experience" | "project";

function splitSentences(text: string): string[] {
  return text
    .split(/[.;\n]+|,\s*(?:y\s+)?/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}
function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr.map((x) => x.trim()).filter(Boolean)) {
    const k = s.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

export async function enrichEntry(
  store: Store,
  ai: AIProvider,
  profileId: string,
  entryType: EntryType,
  entryId: string,
  rawAnswer: string,
): Promise<{ affectedEntryId: string }> {
  const raw = rawAnswer.trim();
  const state = await assembleProfileState(store, profileId);

  if (entryType === "experience") {
    const e = await store.getExperience(entryId);
    if (!e || e.resumeProfileId !== profileId) throw Errors.notFound("Experiencia no encontrada");

    const norm = await ai.normalizeAnswer({
      section: "experience",
      questionId: "experience_scope",
      questionText: "Detalle adicional sobre esta experiencia",
      rawAnswer: raw,
      state,
    });
    const ex = norm.updates.experienceEntries?.[0] ?? {};

    await store.updateExperience(entryId, {
      responsibilities: dedupe([...e.responsibilities, ...(ex.responsibilities ?? []), ...splitSentences(raw)]),
      accomplishments: dedupe([...e.accomplishments, ...(ex.accomplishments ?? [])]),
      tools: dedupe([...e.tools, ...(ex.tools ?? [])]),
      metrics: dedupe([...e.metrics, ...(ex.metrics ?? [])]),
      peopleServed: e.peopleServed ?? ex.peopleServed ?? null,
      rawDescription: [e.rawDescription, raw].filter(Boolean).join(" · "),
    });

    // New detail may reveal new skills for this entry.
    await inferAndPersistSkills(store, ai, await assembleProfileState(store, profileId), {
      focusExperienceIds: [entryId],
    });
    return { affectedEntryId: entryId };
  }

  const p = await store.getProject(entryId);
  if (!p || p.resumeProfileId !== profileId) throw Errors.notFound("Proyecto no encontrado");

  const norm = await ai.normalizeAnswer({
    section: "projects",
    questionId: "projects",
    questionText: "Detalle adicional sobre este proyecto",
    rawAnswer: raw,
    state,
  });
  const pr = norm.updates.projects?.[0] ?? { name: p.name };

  await store.updateProject(entryId, {
    responsibilities: dedupe([...p.responsibilities, ...(pr.responsibilities ?? []), ...splitSentences(raw)]),
    outcomes: dedupe([...p.outcomes, ...(pr.outcomes ?? [])]),
    tools: dedupe([...p.tools, ...(pr.tools ?? [])]),
    description: [p.description, raw].filter(Boolean).join(" · "),
  });
  return { affectedEntryId: entryId };
}
