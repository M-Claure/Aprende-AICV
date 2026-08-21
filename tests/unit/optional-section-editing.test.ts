/**
 * Projects, certifications, languages and achievements must be correctable.
 *
 * They used to be WRITE-ONLY. The funnel asks one question per section, the résumé
 * prints all four, `Store` had full CRUD for each — and no route or screen exposed
 * any of it. So someone who mis-answered "¿qué idiomas hablas?" could neither fix
 * nor remove the answer, and it still reached their PDF. The improvement loop could
 * not reach it either: `enrich-entry` only accepts `experience` and `project`.
 *
 * Two things are pinned here:
 *   1. the `Store` update/delete methods the new PATCH/DELETE routes call actually
 *      round-trip — before this they had no caller anywhere, tests included;
 *   2. the request bodies accept what the Review screen sends and refuse what would
 *      put a nameless entry on a résumé.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { RESUME_ELIGIBLE_CONFIRMATIONS } from "@/types/domain";
import {
  UpdateAchievementBody,
  UpdateCertificationBody,
  UpdateLanguageBody,
  UpdateProjectBody,
} from "@/lib/validation/api-schemas";

let store: MemoryStore;
let profileId: string;

beforeEach(async () => {
  store = new MemoryStore();
  const profile = await store.createResumeProfile("u1", { careerGoal: "Cocinera" });
  profileId = profile.id;
});

describe("editing a project", () => {
  it("saves a correction and can remove the entry", async () => {
    const created = await store.createProject(profileId, {
      name: "Vnta de comida",
      description: "Vendía tortas",
      responsibilities: ["Cocinaba"],
    });

    const fixed = await store.updateProject(created.id, {
      name: "Venta de comida",
      responsibilities: ["Cocinaba", "Atendía a los clientes"],
      confirmationStatus: "edited",
    });
    expect(fixed.name).toBe("Venta de comida");
    expect(fixed.responsibilities).toEqual(["Cocinaba", "Atendía a los clientes"]);
    // Still printable: "edited" is résumé-eligible, so fixing a typo cannot
    // silently drop the entry from the PDF.
    expect(RESUME_ELIGIBLE_CONFIRMATIONS).toContain(fixed.confirmationStatus);

    await store.deleteProject(created.id);
    expect(await store.getProject(created.id)).toBeNull();
    expect(await store.listProjects(profileId)).toHaveLength(0);
  });
});

describe("editing a certification", () => {
  it("saves a correction and can remove the entry", async () => {
    const created = await store.createCertification(profileId, {
      name: "Manejo de alimentos",
      issuingOrganization: "Secretaria de Salud",
    });

    const fixed = await store.updateCertification(created.id, {
      issuingOrganization: "Secretaría de Salud",
      issueDate: "junio de 2019",
      confirmationStatus: "edited",
    });
    expect(fixed.issuingOrganization).toBe("Secretaría de Salud");
    expect(fixed.issueDate).toBe("junio de 2019");
    expect(fixed.name).toBe("Manejo de alimentos"); // untouched by a partial patch

    await store.deleteCertification(created.id);
    expect(await store.getCertification(created.id)).toBeNull();
  });
});

describe("editing a language", () => {
  it("saves the level the résumé prints, and leaves reading/writing alone", async () => {
    const created = await store.createLanguage(profileId, {
      name: "inglés",
      speakingLevel: "basico",
      readingLevel: "avanzado",
      writingLevel: "intermedio",
    });

    // The card shows and writes `speakingLevel` — the one `formatLanguageLevel`
    // prefers — so what is on screen is what prints. The other two survive: the
    // person may genuinely read better than they speak.
    const fixed = await store.updateLanguage(created.id, { speakingLevel: "intermedio" });
    expect(fixed.speakingLevel).toBe("intermedio");
    expect(fixed.readingLevel).toBe("avanzado");
    expect(fixed.writingLevel).toBe("intermedio");
  });

  it("can be kept on file but taken off the résumé", async () => {
    const created = await store.createLanguage(profileId, { name: "francés" });
    expect(created.includeOnResume).toBe(true);

    const hidden = await store.updateLanguage(created.id, { includeOnResume: false });
    // A language has no confirmationStatus, so this flag is the only thing the
    // generator filters on.
    expect(hidden.includeOnResume).toBe(false);
    expect(await store.listLanguages(profileId)).toHaveLength(1);
  });

  it("can be deleted outright — the pipeline can create a nameless one", async () => {
    // `processAnswer` guards `if (!p.name) continue` for projects, certifications and
    // achievements, but NOT for languages: a language with an empty name can be
    // created, and deleting is the only way to get rid of it.
    const nameless = await store.createLanguage(profileId, { name: "" });
    await store.deleteLanguage(nameless.id);
    expect(await store.listLanguages(profileId)).toHaveLength(0);
  });
});

describe("editing an achievement", () => {
  it("saves a correction and can remove the entry", async () => {
    const created = await store.createAchievement(profileId, {
      title: "Empleada del mes",
      organization: "Restaurante",
    });

    const fixed = await store.updateAchievement(created.id, {
      description: "Me lo dieron por atender bien a los clientes.",
      date: "marzo 2021",
      confirmationStatus: "edited",
    });
    expect(fixed.description).toBe("Me lo dieron por atender bien a los clientes.");
    expect(fixed.title).toBe("Empleada del mes");

    await store.deleteAchievement(created.id);
    expect(await store.getAchievement(created.id)).toBeNull();
  });
});

describe("request bodies", () => {
  it("accept a partial patch — a card sends only what it shows", () => {
    expect(UpdateProjectBody.safeParse({ name: "Venta de comida" }).success).toBe(true);
    expect(UpdateCertificationBody.safeParse({ issueDate: "2019" }).success).toBe(true);
    expect(UpdateLanguageBody.safeParse({ includeOnResume: false }).success).toBe(true);
    expect(UpdateAchievementBody.safeParse({ date: "marzo 2021" }).success).toBe(true);
  });

  it("refuse to blank out the name that identifies the entry", () => {
    // An entry with no name prints as an empty bullet, so the API rejects it rather
    // than storing it. The Review screen blocks Guardar for the same reason.
    expect(UpdateProjectBody.safeParse({ name: "" }).success).toBe(false);
    expect(UpdateProjectBody.safeParse({ name: "   " }).success).toBe(false);
    expect(UpdateCertificationBody.safeParse({ name: "" }).success).toBe(false);
    expect(UpdateLanguageBody.safeParse({ name: "" }).success).toBe(false);
    expect(UpdateAchievementBody.safeParse({ title: "" }).success).toBe(false);
  });

  it("clears a language level with null rather than an empty string", () => {
    // "Sin especificar" in the dropdown means no level, which the domain spells
    // `null`; an empty string is not one of LANGUAGE_LEVELS.
    expect(UpdateLanguageBody.safeParse({ speakingLevel: null }).success).toBe(true);
    expect(UpdateLanguageBody.safeParse({ speakingLevel: "" }).success).toBe(false);
    expect(UpdateLanguageBody.safeParse({ speakingLevel: "intermedio" }).success).toBe(true);
  });

  it("rejects a confirmationStatus on a language — it has none", () => {
    const parsed = UpdateLanguageBody.safeParse({ confirmationStatus: "edited" });
    // Zod strips unknown keys rather than failing, so assert the key never reaches
    // the store patch: `updateLanguage` has no such column.
    expect(parsed.success).toBe(true);
    expect(parsed.success && "confirmationStatus" in parsed.data).toBe(false);
  });
});
