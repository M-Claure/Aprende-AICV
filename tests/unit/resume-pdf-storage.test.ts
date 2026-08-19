import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { generateResume } from "@/lib/resume/resume-generator";
import { proofreadAndRerender } from "@/lib/resume/proofread-resume";
import { createResumePdfWriter } from "@/lib/resume/resume-artifacts";
import { MemoryResumeFileStore, resumePdfPath } from "@/lib/storage/resume-file-store";
import type { PdfGenerator } from "@/lib/resume/pdf-generator";

/**
 * "Save the PDF as the user goes, replacing what was there."
 *
 * The invariant under test: every path that creates a `generated_resumes` row
 * leaves exactly ONE stored PDF for the profile, holding the newest render — and
 * a PDF failure never costs the user their résumé.
 */

const USER = "u1";
let store: MemoryStore;
let files: MemoryResumeFileStore;
const ai = new MockAIProvider();

/** A stand-in for Chromium: records calls and returns identifiable bytes. */
function fakePdf(): PdfGenerator & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    available: true,
    async generate(html: string) {
      calls.push(html);
      // Encode the call index so a replacement is distinguishable from the original.
      return new TextEncoder().encode(`PDF#${calls.length}`);
    },
  };
}

function writer(pdf: PdfGenerator) {
  return createResumePdfWriter({ userId: USER, store, pdf, files });
}

async function seedProfile() {
  const profile = await store.createResumeProfile(USER, {
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
  return profile.id;
}

const read = async (profileId: string) =>
  new TextDecoder().decode((await files.getResumePdf({ userId: USER, profileId }))!);

beforeEach(() => {
  store = new MemoryStore();
  files = new MemoryResumeFileStore();
});

describe("object path", () => {
  it("puts the user id first, which is what the storage RLS policy authorizes on", () => {
    // supabase/migrations/0006 authorizes on (storage.foldername(name))[1].
    // Reordering these segments would silently change who can read the file.
    expect(resumePdfPath({ userId: "user-a", profileId: "prof-1" })).toBe(
      "user-a/prof-1/curriculum.pdf",
    );
    expect(resumePdfPath({ userId: "user-a", profileId: "prof-1" }).split("/")[0]).toBe("user-a");
  });

  it("gives every profile of a user its own object", () => {
    const a = resumePdfPath({ userId: USER, profileId: "p1" });
    const b = resumePdfPath({ userId: USER, profileId: "p2" });
    expect(a).not.toBe(b);
  });
});

describe("generation saves a PDF", () => {
  it("stores one on the first generation and records its path on the row", async () => {
    const pdf = fakePdf();
    const id = await seedProfile();

    const { resume } = await generateResume(store, ai, id, writer(pdf));

    expect(pdf.calls).toHaveLength(1);
    expect(resume.pdfPath).toBe(resumePdfPath({ userId: USER, profileId: id }));
    expect(await read(id)).toBe("PDF#1");
    // The returned résumé carries the path, not a stale pre-save copy.
    const persisted = await store.getGeneratedResume(resume.id);
    expect(persisted?.pdfPath).toBe(resume.pdfPath);
  });

  it("replaces the stored PDF on every regeneration, never accumulating", async () => {
    const pdf = fakePdf();
    const id = await seedProfile();

    await generateResume(store, ai, id, writer(pdf));
    expect(await read(id)).toBe("PDF#1");

    await generateResume(store, ai, id, writer(pdf));
    await generateResume(store, ai, id, writer(pdf));

    // Three generations, three renders — but still exactly one stored object,
    // holding the newest render.
    expect(pdf.calls).toHaveLength(3);
    expect(files.size).toBe(1);
    expect(await read(id)).toBe("PDF#3");
  });

  it("replaces it after a proofread pass too", async () => {
    const pdf = fakePdf();
    const id = await seedProfile();
    await generateResume(store, ai, id, writer(pdf));

    const { resume } = await proofreadAndRerender(store, ai, id, writer(pdf));

    expect(files.size).toBe(1);
    expect(await read(id)).toBe("PDF#2");
    expect(resume.pdfPath).toBe(resumePdfPath({ userId: USER, profileId: id }));
  });

  it("keeps each profile's PDF separate", async () => {
    const pdf = fakePdf();
    const a = await seedProfile();
    const b = await seedProfile();

    await generateResume(store, ai, a, writer(pdf));
    await generateResume(store, ai, b, writer(pdf));

    expect(files.size).toBe(2);
    expect(await read(a)).toBe("PDF#1");
    expect(await read(b)).toBe("PDF#2");
  });
});

describe("a PDF failure never costs the user their résumé", () => {
  it("still returns and persists the résumé when rendering throws", async () => {
    const broken: PdfGenerator = {
      available: true,
      generate: async () => {
        throw new Error("Chromium no disponible");
      },
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await seedProfile();

    const { resume } = await generateResume(store, ai, id, writer(broken));

    expect(resume.professionalSummary.length).toBeGreaterThan(0);
    expect(resume.pdfPath).toBeNull();
    expect(await files.getResumePdf({ userId: USER, profileId: id })).toBeNull();
    // Silent failure would make this undiagnosable, so it must be logged.
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("still returns the résumé when the upload throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(files, "putResumePdf").mockRejectedValueOnce(new Error("storage down"));
    const id = await seedProfile();

    const { resume } = await generateResume(store, ai, id, writer(fakePdf()));

    expect(resume.id).toBeTruthy();
    expect(resume.pdfPath).toBeNull();
    consoleError.mockRestore();
  });

  it("leaves the previous PDF in place when a later render fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const good = fakePdf();
    const id = await seedProfile();
    await generateResume(store, ai, id, writer(good));

    const broken: PdfGenerator = {
      available: true,
      generate: async () => {
        throw new Error("boom");
      },
    };
    await generateResume(store, ai, id, writer(broken));

    // A failed replacement must not destroy what was already downloadable.
    expect(await read(id)).toBe("PDF#1");
    consoleError.mockRestore();
  });

  it("does not overwrite a good PDF with a render of empty content", async () => {
    const pdf = fakePdf();
    const id = await seedProfile();
    await generateResume(store, ai, id, writer(pdf));

    const resume = (await store.getLatestGeneratedResume(id))!;
    await writer(pdf).onResumeCreated({ ...resume, html: "   " });

    expect(pdf.calls).toHaveLength(1); // never rendered the blank one
    expect(await read(id)).toBe("PDF#1");
  });
});

describe("generation without an artifact writer", () => {
  it("is unchanged — nothing is rendered or stored", async () => {
    // The parameter is optional so the existing suite runs without Chromium.
    const id = await seedProfile();
    const { resume } = await generateResume(store, ai, id);
    expect(resume.pdfPath).toBeNull();
    expect(files.size).toBe(0);
  });
});
