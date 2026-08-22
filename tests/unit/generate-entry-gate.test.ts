/**
 * `POST /generate` refuses a profile whose entries are still half-filled.
 *
 * The rule lived only in `EditableReview`'s disabled button, and two of that
 * route's three callers never render it — the improvement round's "Regenerar" calls
 * the API directly. So the per-entry rule held for a person's FIRST résumé and
 * silently stopped holding for every regeneration after it.
 *
 * What this file pins is the reason the server check is not redundant: a profile can
 * pass `readyToGenerate` and still have an entry the rule rejects. The two gates
 * answer different questions — "do you have the basics?" versus "is each card
 * finished?" — so neither implies the other.
 */
import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { assembleProfileState } from "@/lib/profile-state";
import { describeIncompleteEntries, incompleteEntries } from "@/lib/entry-required-fields";

/** Exactly the expression the route evaluates. */
function routeWouldRefuse(state: Parameters<typeof incompleteEntries>[0] & {
  completeness: { readyToGenerate: boolean };
}): string | null {
  if (!state.completeness.readyToGenerate) return null; // generateResume owns that error
  return describeIncompleteEntries(incompleteEntries(state));
}

/** A profile with everything readiness asks for: name, contact, objective, skill. */
async function readyProfile(store: MemoryStore) {
  const profile = await store.createResumeProfile("u1", { targetRole: "Recepcionista" });
  await store.upsertPersonalInformation(profile.id, { firstName: "María", email: "m@e.com" });
  await store.createSkill(profile.id, { name: "Atención al cliente", status: "confirmed" });
  return profile;
}

describe("the server gate catches what readiness lets through", () => {
  it("refuses an experience with no name, even though the profile is ready", async () => {
    const store = new MemoryStore();
    const profile = await readyProfile(store);
    // Not blank — it has a description, so `isExperienceBlank` is false and the
    // completeness engine counts it as a real background.
    await store.createExperience(profile.id, {
      experienceType: "caregiving",
      rawDescription: "Cuidé a mi abuela",
      startDate: "marzo 2020",
      isCurrent: true,
      confirmationStatus: "confirmed",
    });

    const state = await assembleProfileState(store, profile.id);
    // Readiness is satisfied — which is exactly why the second gate is needed.
    expect(state.completeness.readyToGenerate).toBe(true);
    expect(routeWouldRefuse(state)).toContain("Puesto / rol u Organización");
  });

  it("lets a finished profile through", async () => {
    const store = new MemoryStore();
    const profile = await readyProfile(store);
    await store.createExperience(profile.id, {
      experienceType: "caregiving",
      title: "Cuidadora",
      rawDescription: "Cuidé a mi abuela",
      startDate: "marzo 2020",
      isCurrent: true,
      confirmationStatus: "confirmed",
    });

    const state = await assembleProfileState(store, profile.id);
    expect(state.completeness.readyToGenerate).toBe(true);
    expect(routeWouldRefuse(state)).toBeNull();
  });

  it("stays silent when the basics are missing, so the canonical error wins", async () => {
    const store = new MemoryStore();
    // No personal information and no skill: readiness fails.
    const profile = await store.createResumeProfile("u1", { targetRole: "Recepcionista" });
    await store.createExperience(profile.id, {
      experienceType: "other",
      rawDescription: "Algo",
      confirmationStatus: "confirmed",
    });

    const state = await assembleProfileState(store, profile.id);
    expect(state.completeness.readyToGenerate).toBe(false);
    // `generateResume` raises `missingCriticalFields`; masking it with a narrower
    // message would tell the person to fix a date when they have no name on file.
    expect(routeWouldRefuse(state)).toBeNull();
  });
});
