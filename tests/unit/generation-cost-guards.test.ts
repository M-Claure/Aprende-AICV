/**
 * Two guards against paying twice for the same work:
 *   - a critique is reused until the résumé or the facts behind it change, instead
 *     of being regenerated every time the workspace mounts;
 *   - concurrent generations for one profile collapse into a single model call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { analyzeResume } from "@/lib/resume/resume-analyzer";
import { clearAnalysisCache } from "@/lib/resume/analysis-cache";
import { clearGenerationLocks } from "@/lib/resume/generation-lock";
import { generateResume } from "@/lib/resume/resume-generator";

let store: MemoryStore;

async function seedReadyProfile() {
  const profile = await store.createResumeProfile("u1", {
    careerGoal: "Asistente administrativa",
    targetRole: "Asistente administrativa",
  });
  await store.upsertPersonalInformation(profile.id, { firstName: "María", email: "m@e.com" });
  await store.createExperience(profile.id, {
    experienceType: "family_business",
    organization: "Negocio familiar",
    responsibilities: ["Contestaba llamadas"],
    confirmationStatus: "confirmed",
  });
  await store.createSkill(profile.id, { name: "Atención al cliente", status: "confirmed" });
  return profile.id;
}

/** A provider that counts how often each expensive operation is actually called. */
function countingProvider() {
  const ai = new MockAIProvider();
  const counts = { analyze: 0, generate: 0 };
  const realAnalyze = ai.analyzeResume.bind(ai);
  const realGenerate = ai.generateResumeContent.bind(ai);
  vi.spyOn(ai, "analyzeResume").mockImplementation((p) => {
    counts.analyze += 1;
    return realAnalyze(p);
  });
  vi.spyOn(ai, "generateResumeContent").mockImplementation((i) => {
    counts.generate += 1;
    return realGenerate(i);
  });
  return { ai, counts };
}

beforeEach(() => {
  store = new MemoryStore();
  clearAnalysisCache();
  clearGenerationLocks();
  vi.restoreAllMocks();
});

describe("a critique is not paid for twice", () => {
  it("reuses the analysis when nothing has changed", async () => {
    const { ai, counts } = countingProvider();
    const id = await seedReadyProfile();
    await generateResume(store, ai, id);

    const first = await analyzeResume(store, ai, id);
    const second = await analyzeResume(store, ai, id); // e.g. the user reloaded
    const third = await analyzeResume(store, ai, id);

    expect(counts.analyze).toBe(1);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("re-analyzes once the person answers something", async () => {
    const { ai, counts } = countingProvider();
    const id = await seedReadyProfile();
    await generateResume(store, ai, id);
    await analyzeResume(store, ai, id);

    // Answering a follow-up changes a fact the gap detectors read.
    await store.createLanguage(id, { name: "Español", speakingLevel: "nativo" });
    await analyzeResume(store, ai, id);

    expect(counts.analyze).toBe(2);
  });

  it("re-analyzes a freshly regenerated résumé", async () => {
    const { ai, counts } = countingProvider();
    const id = await seedReadyProfile();
    await generateResume(store, ai, id);
    await analyzeResume(store, ai, id);

    await generateResume(store, ai, id); // new version
    await analyzeResume(store, ai, id);

    expect(counts.analyze).toBe(2);
  });

  it("notices enrichment of an experience, not just new sections", async () => {
    const { ai, counts } = countingProvider();
    const id = await seedReadyProfile();
    await generateResume(store, ai, id);
    await analyzeResume(store, ai, id);

    // A deep-dive answer lands as tools/people on the entry — the thinness the
    // analyzer branches on. A key that only tracked the résumé would miss this.
    const [entry] = await store.listExperience(id);
    await store.updateExperience(entry!.id, { tools: ["Excel"], peopleServed: "clientes" });
    await analyzeResume(store, ai, id);

    expect(counts.analyze).toBe(2);
  });

  it("never serves one profile's analysis to another", async () => {
    const { ai, counts } = countingProvider();
    const a = await seedReadyProfile();
    const b = await seedReadyProfile();
    await generateResume(store, ai, a);
    await generateResume(store, ai, b);

    await analyzeResume(store, ai, a);
    await analyzeResume(store, ai, b);

    expect(counts.analyze).toBe(2);
  });

  it("does not cache a failed analysis, so recovery works on the next try", async () => {
    const id = await seedReadyProfile();
    const ai = new MockAIProvider();
    await generateResume(store, ai, id);

    const failing = new MockAIProvider();
    vi.spyOn(failing, "analyzeResume").mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const degraded = await analyzeResume(store, failing, id);
    expect(degraded.strengths).toEqual([]); // deterministic fallback

    // A later healthy call must produce a real critique rather than the cached fallback.
    const healthy = await analyzeResume(store, ai, id);
    expect(healthy.strengths.length).toBeGreaterThan(0);
  });
});

describe("a double-click does not generate twice", () => {
  it("collapses concurrent generations into one model call", async () => {
    const { ai, counts } = countingProvider();
    const id = await seedReadyProfile();

    // Both requests are in flight at once — the second must join the first.
    const [a, b] = await Promise.all([generateResume(store, ai, id), generateResume(store, ai, id)]);

    expect(counts.generate).toBe(1);
    expect(a.resume.id).toBe(b.resume.id);
    expect(a.resume.version).toBe(b.resume.version);
    // And only one version was written.
    expect((await store.getLatestGeneratedResume(id))!.version).toBe(1);
  });

  it("still regenerates when asked again after the first finishes", async () => {
    const { ai, counts } = countingProvider();
    const id = await seedReadyProfile();

    await generateResume(store, ai, id);
    await generateResume(store, ai, id);

    expect(counts.generate).toBe(2);
    expect((await store.getLatestGeneratedResume(id))!.version).toBe(2);
  });

  it("releases the lock when a generation fails", async () => {
    const id = await seedReadyProfile();
    const failing = new MockAIProvider();
    vi.spyOn(failing, "generateResumeContent").mockRejectedValueOnce(new Error("boom"));

    await expect(generateResume(store, failing, id)).rejects.toThrow("boom");
    // A wedged lock would make every later attempt reuse the rejected promise.
    await expect(generateResume(store, failing, id)).resolves.toBeTruthy();
  });

  it("does not block a different profile", async () => {
    const { ai, counts } = countingProvider();
    const a = await seedReadyProfile();
    const b = await seedReadyProfile();

    const [ra, rb] = await Promise.all([generateResume(store, ai, a), generateResume(store, ai, b)]);

    expect(counts.generate).toBe(2);
    expect(ra.resume.id).not.toBe(rb.resume.id);
  });
});
