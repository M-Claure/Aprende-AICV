import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { generateResume } from "@/lib/resume/resume-generator";
import { proofreadAndRerender } from "@/lib/resume/proofread-resume";

let store: MemoryStore;
const ai = new MockAIProvider();

async function seedGenerated() {
  const profile = await store.createResumeProfile("u1", {
    careerGoal: "Vendedora",
    targetRole: "Vendedora",
  });
  await store.upsertPersonalInformation(profile.id, { firstName: "Ana", email: "a@e.com" });
  await store.createExperience(profile.id, {
    experienceType: "informal_work",
    organization: "Tienda",
    responsibilities: ["Vendía ropa", "Manejaba la caja"],
    tools: ["caja registradora"],
    peopleServed: "clientes de la tienda",
    confirmationStatus: "confirmed",
  });
  await store.createSkill(profile.id, { name: "Ventas", status: "confirmed" });
  await generateResume(store, ai, profile.id);
  return profile.id;
}

beforeEach(() => {
  store = new MemoryStore();
});

describe("proofreadAndRerender", () => {
  it("applies corrections by id, preserves source tracing, and re-renders", async () => {
    const id = await seedGenerated();
    const before = await store.getLatestGeneratedResume(id);
    const originalBullets = before!.experience.flatMap((e) => e.bullets);
    expect(originalBullets.length).toBeGreaterThan(0);

    // A proofreader that rewrites only the summary and echoes bullets unchanged.
    const proofer = Object.assign(Object.create(Object.getPrototypeOf(ai)), ai, {
      proofreadResume: async ({ items }: { items: Array<{ id: string; text: string }> }) => ({
        items: items.map((it) => (it.id === "summary" ? { id: it.id, text: "Resumen corregido." } : it)),
        notes: ["Corregí acentos y puntuación"],
      }),
    });

    const { resume, notes } = await proofreadAndRerender(store, proofer, id);

    expect(resume.professionalSummary).toBe("Resumen corregido.");
    expect(notes).toContain("Corregí acentos y puntuación");
    expect(resume.html).toContain("Resumen corregido.");

    // Structure + source tracing preserved on every bullet.
    const bullets = resume.experience.flatMap((e) => e.bullets);
    expect(bullets.length).toBe(originalBullets.length);
    for (const b of bullets) expect(b.sourceEntryIds.length).toBeGreaterThan(0);

    // A new version was persisted.
    expect(resume.version).toBeGreaterThan(before!.version);
  });

  it("keeps original text for any snippet the model omits", async () => {
    const id = await seedGenerated();
    const before = await store.getLatestGeneratedResume(id);

    // Model returns nothing → everything falls back to the original text.
    const emptyProofer = Object.assign(Object.create(Object.getPrototypeOf(ai)), ai, {
      proofreadResume: async () => ({ items: [], notes: [] }),
    });

    const { resume } = await proofreadAndRerender(store, emptyProofer, id);
    expect(resume.professionalSummary).toBe(before!.professionalSummary);
    expect(resume.experience.flatMap((e) => e.bullets).map((b) => b.text)).toEqual(
      before!.experience.flatMap((e) => e.bullets).map((b) => b.text),
    );
  });
});
