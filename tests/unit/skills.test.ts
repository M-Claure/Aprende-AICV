import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { inferAndPersistSkills, isProhibitedSuggestion } from "@/lib/skills/skill-inference";
import {
  addUserSkill,
  applySkillDecisions,
  confirmSkill,
  editSkill,
  rejectSkill,
} from "@/lib/skills/skill-confirmation";
import { assembleProfileState } from "@/lib/profile-state";

let store: MemoryStore;
const provider = new MockAIProvider();

async function seedProfile() {
  const profile = await store.createResumeProfile("user-1", { careerGoal: "Asistente" });
  await store.upsertPersonalInformation(profile.id, { firstName: "María", email: "m@e.com" });
  await store.createExperience(profile.id, {
    experienceType: "family_business",
    organization: "Negocio familiar",
    responsibilities: ["Contestaba llamadas de clientes", "Organizaba las citas"],
    rawDescription: "Ayudaba en el negocio de limpieza de mi mamá",
  });
  return profile.id;
}

beforeEach(() => {
  store = new MemoryStore();
});

describe("inferAndPersistSkills", () => {
  it("creates evidence-backed skills with status 'suggested' (never confirmed)", async () => {
    const profileId = await seedProfile();
    const state = await assembleProfileState(store, profileId);
    const created = await inferAndPersistSkills(store, provider, state);

    expect(created.length).toBeGreaterThan(0);
    for (const s of created) {
      expect(s.status).toBe("suggested");
      expect(s.origin).toBe("experience_inference");
      expect(s.evidence).toBeTruthy();
      expect(s.sourceEntryId).toBeTruthy();
    }
    expect(created.map((s) => s.name)).toContain("Atención al cliente");
  });

  it("never re-suggests a skill that already exists in any status", async () => {
    const profileId = await seedProfile();
    let state = await assembleProfileState(store, profileId);
    await inferAndPersistSkills(store, provider, state);
    // Reject one, then re-run inference — it must not come back.
    const all = await store.listSkills(profileId);
    await rejectSkill(store, all[0]!.id);

    state = await assembleProfileState(store, profileId);
    const second = await inferAndPersistSkills(store, provider, state);
    expect(second.map((s) => s.name)).not.toContain(all[0]!.name);
  });
});

describe("isProhibitedSuggestion (spec §10 guardrails)", () => {
  it("blocks leadership skills without leadership evidence", () => {
    expect(
      isProhibitedSuggestion({ name: "Liderazgo", category: "Gestión", evidence: "Trabajaba sola" }),
    ).toBe(true);
  });
  it("allows leadership when evidence supports it", () => {
    expect(
      isProhibitedSuggestion({
        name: "Liderazgo de equipo",
        category: "Gestión",
        evidence: "Supervisaba a 3 personas",
      }),
    ).toBe(false);
  });
  it("blocks language fluency as an inferred skill", () => {
    expect(
      isProhibitedSuggestion({ name: "Inglés fluido", category: "Idiomas", evidence: "Estudié inglés" }),
    ).toBe(true);
  });
  it("blocks any suggestion without evidence", () => {
    expect(isProhibitedSuggestion({ name: "Excel", category: "Herramientas", evidence: "" })).toBe(true);
  });
});

describe("skill confirmation lifecycle", () => {
  it("confirms, rejects and edits skills", async () => {
    const profileId = await seedProfile();
    const state = await assembleProfileState(store, profileId);
    const [a, b, c] = await inferAndPersistSkills(store, provider, state);

    const confirmed = await confirmSkill(store, a!.id);
    expect(confirmed.status).toBe("confirmed");

    const rejected = await rejectSkill(store, b!.id);
    expect(rejected.status).toBe("rejected");

    const edited = await editSkill(store, c!.id, { name: "Nombre editado" });
    expect(edited.status).toBe("edited");
    expect(edited.name).toBe("Nombre editado");
  });

  it("addUserSkill creates a confirmed, user_entered skill", async () => {
    const profileId = await seedProfile();
    const skill = await addUserSkill(store, profileId, { name: "Puntualidad" });
    expect(skill.status).toBe("confirmed");
    expect(skill.origin).toBe("user_entered");
  });

  it("addUserSkill promotes an existing suggestion instead of duplicating", async () => {
    const profileId = await seedProfile();
    const state = await assembleProfileState(store, profileId);
    const [a] = await inferAndPersistSkills(store, provider, state);
    const promoted = await addUserSkill(store, profileId, { name: a!.name });
    expect(promoted.id).toBe(a!.id);
    expect(promoted.status).toBe("confirmed");
  });

  it("applySkillDecisions confirms and rejects in batch", async () => {
    const profileId = await seedProfile();
    const state = await assembleProfileState(store, profileId);
    const skills = await inferAndPersistSkills(store, provider, state);
    await applySkillDecisions(store, {
      confirm: [skills[0]!.id],
      reject: [skills[1]!.id],
    });
    const after = await store.listSkills(profileId);
    expect(after.find((s) => s.id === skills[0]!.id)!.status).toBe("confirmed");
    expect(after.find((s) => s.id === skills[1]!.id)!.status).toBe("rejected");
  });
});
