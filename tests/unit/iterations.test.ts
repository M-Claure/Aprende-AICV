import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { MAX_RESUME_ITERATIONS } from "@/lib/config/limits";

/**
 * The improvement loop's server-side state.
 *
 * The round counter used to live in the browser's localStorage, which meant the
 * "you may improve this 3 times" cap reset on a new device or a cleared cache.
 * It is a column on `funnel` now, and the three `iteration_N` tables log what was
 * asked and answered in each round.
 */
let store: MemoryStore;
let profileId: string;

beforeEach(async () => {
  store = new MemoryStore();
  const profile = await store.createResumeProfile("u1", { careerGoal: "Vendedora" });
  profileId = profile.id;
});

describe("round counter", () => {
  it("starts at zero", async () => {
    expect(await store.getIteration(profileId)).toBe(0);
  });

  it("advances one round at a time", async () => {
    expect(await store.advanceIteration(profileId, MAX_RESUME_ITERATIONS)).toBe(1);
    expect(await store.advanceIteration(profileId, MAX_RESUME_ITERATIONS)).toBe(2);
    expect(await store.getIteration(profileId)).toBe(2);
  });

  it("clamps at the cap instead of running past it", async () => {
    for (let i = 0; i < 10; i++) await store.advanceIteration(profileId, MAX_RESUME_ITERATIONS);
    expect(await store.getIteration(profileId)).toBe(MAX_RESUME_ITERATIONS);
  });

  it("is tracked per profile", async () => {
    const other = await store.createResumeProfile("u1", {});
    await store.advanceIteration(profileId, MAX_RESUME_ITERATIONS);
    expect(await store.getIteration(profileId)).toBe(1);
    expect(await store.getIteration(other.id)).toBe(0);
  });
});

describe("round Q&A log", () => {
  it("keeps the question text alongside the answer", async () => {
    // The point of these tables: the answer pipeline only ever sees a raw answer,
    // so without this the question that prompted it is lost.
    const entry = await store.recordIterationAnswer(profileId, 1, {
      questionId: "experience_results",
      question: "¿Qué lograste en la tienda?",
      answer: "Subí las ventas.",
    });
    expect(entry).toMatchObject({
      iteration: 1,
      questionId: "experience_results",
      question: "¿Qué lograste en la tienda?",
      answer: "Subí las ventas.",
      resumeProfileId: profileId,
    });
  });

  it("keeps each round separate", async () => {
    await store.recordIterationAnswer(profileId, 1, { questionId: "a", question: "P1", answer: "R1" });
    await store.recordIterationAnswer(profileId, 2, { questionId: "b", question: "P2", answer: "R2" });
    await store.recordIterationAnswer(profileId, 3, { questionId: "c", question: "P3", answer: "R3" });

    for (const round of [1, 2, 3]) {
      const rows = await store.listIterationAnswers(profileId, round);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.question).toBe(`P${round}`);
    }
  });

  it("returns a round's answers oldest first", async () => {
    for (const n of [1, 2, 3]) {
      await store.recordIterationAnswer(profileId, 1, {
        questionId: `q${n}`,
        question: `Pregunta ${n}`,
        answer: `Respuesta ${n}`,
      });
    }
    const rows = await store.listIterationAnswers(profileId, 1);
    expect(rows.map((r) => r.questionId)).toEqual(["q1", "q2", "q3"]);
  });

  it("accepts a skipped improvement as a null answer", async () => {
    const entry = await store.recordIterationAnswer(profileId, 1, {
      questionId: "interests",
      question: "¿Qué te gusta hacer?",
    });
    expect(entry.answer).toBeNull();
  });

  it("does not leak one profile's log into another's", async () => {
    const other = await store.createResumeProfile("u1", {});
    await store.recordIterationAnswer(profileId, 1, { questionId: "a", question: "P", answer: "R" });
    expect(await store.listIterationAnswers(other.id, 1)).toEqual([]);
  });
});

describe("the cap the funnel enforces", () => {
  it("matches the three iteration tables the schema ships", () => {
    // supabase/migrations/0007 creates iteration_1..3. A different cap here would
    // mean answers addressed to a table that does not exist.
    expect(MAX_RESUME_ITERATIONS).toBe(3);
  });
});
