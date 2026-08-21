import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { generateResume } from "@/lib/resume/resume-generator";
import { proofreadAndRerender } from "@/lib/resume/proofread-resume";
import { createResumePdfWriter } from "@/lib/resume/resume-artifacts";
import { MemoryResumeFileStore, resumePdfPath } from "@/lib/storage/resume-file-store";
import { MAX_RESUME_ITERATIONS } from "@/lib/config/limits";
import type { PdfGenerator } from "@/lib/resume/pdf-generator";

/**
 * "Save the PDF as the user goes — one per improvement round."
 *
 * The invariants under test (see supabase/migrations/0008_resume_pdf_per_stage.sql):
 *  * every path that creates a résumé stores its PDF under the round it belongs
 *    to, so the rounds accumulate into a visible history;
 *  * within a round, a re-render REPLACES the object rather than adding one, so
 *    storage is bounded by the round cap and not by how often a user regenerates;
 *  * the round's `iteration_N` rows are stamped with the path they produced;
 *  * and a PDF failure never costs the user their résumé.
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

const read = async (profileId: string, stage = 0) =>
  new TextDecoder().decode((await files.getResumePdf({ userId: USER, profileId, stage }))!);

/**
 * Generate exactly the way `POST /generate` does — including the detail that
 * makes the stages line up: the FIRST generation is free and leaves the round
 * counter alone; every one after it closes a round and bumps it.
 */
async function closeRound(profileId: string, pdf: PdfGenerator) {
  const isRegeneration = (await store.getLatestGeneratedResume(profileId)) !== null;
  await generateResume(store, ai, profileId, writer(pdf));
  if (isRegeneration) await store.advanceIteration(profileId, MAX_RESUME_ITERATIONS);
}

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
    for (const stage of [0, 1, 2, 3]) {
      expect(
        resumePdfPath({ userId: "user-a", profileId: "prof-1", stage }).split("/")[0],
      ).toBe("user-a");
    }
  });

  it("keeps curriculum.pdf for stage 0 so pre-0008 objects are not orphaned", () => {
    const ref = { userId: USER, profileId: "p1" };
    expect(resumePdfPath(ref)).toBe(`${USER}/p1/curriculum.pdf`);
    expect(resumePdfPath({ ...ref, stage: 0 })).toBe(resumePdfPath(ref));
  });

  it("gives every improvement round its own object", () => {
    const ref = { userId: USER, profileId: "p1" };
    const paths = [0, 1, 2, 3].map((stage) => resumePdfPath({ ...ref, stage }));
    expect(paths).toEqual([
      `${USER}/p1/curriculum.pdf`,
      `${USER}/p1/iteration-1.pdf`,
      `${USER}/p1/iteration-2.pdf`,
      `${USER}/p1/iteration-3.pdf`,
    ]);
    expect(new Set(paths).size).toBe(4);
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
    // The first generation is round 0 — before any improvement round.
    expect(resume.stage).toBe(0);
    expect(resume.pdfPath).toBe(resumePdfPath({ userId: USER, profileId: id }));
    expect(await read(id)).toBe("PDF#1");
    // The returned résumé carries the path, not a stale pre-save copy.
    const persisted = await store.getGeneratedResume(resume.id);
    expect(persisted?.pdfPath).toBe(resume.pdfPath);
  });

  it("replaces the open round's PDF on every regeneration, never accumulating", async () => {
    const pdf = fakePdf();
    const id = await seedProfile();

    await generateResume(store, ai, id, writer(pdf));
    expect(await read(id)).toBe("PDF#1");

    // Two more generations without the round counter moving — a section
    // regeneration, say. They belong to the same open round, so they overwrite
    // its object instead of consuming the rounds after it.
    await generateResume(store, ai, id, writer(pdf));
    await generateResume(store, ai, id, writer(pdf));

    expect(pdf.calls).toHaveLength(3);
    expect(files.size).toBe(2); // curriculum.pdf + the open round's
    expect(await read(id, 1)).toBe("PDF#3");
    // The initial generation's PDF is untouched by later rounds.
    expect(await read(id, 0)).toBe("PDF#1");
  });

  it("keeps one PDF per round, so the rounds read as a history", async () => {
    const pdf = fakePdf();
    const id = await seedProfile();

    await closeRound(id, pdf); // initial generation → curriculum.pdf
    await closeRound(id, pdf); // round 1 → iteration-1.pdf
    await closeRound(id, pdf); // round 2 → iteration-2.pdf
    await closeRound(id, pdf); // round 3 → iteration-3.pdf

    // Four generations, four objects — every earlier round still readable.
    expect(files.size).toBe(4);
    expect(await read(id, 0)).toBe("PDF#1");
    expect(await read(id, 1)).toBe("PDF#2");
    expect(await read(id, 2)).toBe("PDF#3");
    expect(await read(id, 3)).toBe("PDF#4");
  });

  it("never writes past the last round, however many times it regenerates", async () => {
    const pdf = fakePdf();
    const id = await seedProfile();
    for (let i = 0; i < MAX_RESUME_ITERATIONS + 4; i++) await closeRound(id, pdf);

    // MAX_RESUME_ITERATIONS is 3 and there is one table per round, so a 4th
    // stage would name a PDF no `iteration_N` table could reference.
    expect(files.size).toBe(MAX_RESUME_ITERATIONS + 1);
    const { resume } = await generateResume(store, ai, id, writer(pdf));
    expect(resume.stage).toBe(MAX_RESUME_ITERATIONS);
  });

  it("stamps the round's logged answers with the PDF they produced", async () => {
    const pdf = fakePdf();
    const id = await seedProfile();
    await closeRound(id, pdf); // initial generation, no round to stamp

    // The user answers two round-1 questions, then regenerates.
    await store.recordIterationAnswer(id, 1, { questionId: "q1", question: "¿Y?", answer: "sí" });
    await store.recordIterationAnswer(id, 1, { questionId: "q2", question: "¿Ya?", answer: "no" });
    await generateResume(store, ai, id, writer(pdf));

    const round1 = await store.listIterationAnswers(id, 1);
    const expected = resumePdfPath({ userId: USER, profileId: id, stage: 1 });
    // Same value on every row of the round — one row per question, so any row
    // you open names the PDF the round ended up with.
    expect(round1.map((a) => a.resumePdfPath)).toEqual([expected, expected]);
    // ...and only that round's.
    expect((await store.listIterationAnswers(id, 2)).length).toBe(0);
  });

  it("replaces the round's PDF after a proofread pass too", async () => {
    const pdf = fakePdf();
    const id = await seedProfile();
    await closeRound(id, pdf); // curriculum.pdf = PDF#1
    await generateResume(store, ai, id, writer(pdf)); // round 1 = PDF#2

    const { resume } = await proofreadAndRerender(store, ai, id, writer(pdf));

    // A proofread is a re-render of the round on file, not a new round.
    expect(resume.stage).toBe(1);
    expect(files.size).toBe(2);
    expect(await read(id, 1)).toBe("PDF#3");
    expect(resume.pdfPath).toBe(resumePdfPath({ userId: USER, profileId: id, stage: 1 }));
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
