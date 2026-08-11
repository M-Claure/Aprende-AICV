/**
 * A question's `charLimit` is a PROMISE: an answer at exactly that length must
 * survive the whole pipeline. It is easy to break, because the answer flows into
 * Zod-capped fields downstream (`updates.careerGoal` at 300, `credential` at
 * 200, a skill's `evidence` at 400 …) and a charLimit above any of those turns a
 * perfectly valid answer into a 500.
 *
 * This walks every catalog question at its own limit through the real pipeline on
 * the deterministic provider — no API cost — and fails if any is rejected.
 * It caught three such mismatches when the per-question limits were introduced.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { NoopAnalytics } from "@/lib/analytics";
import { processAnswer, type PipelineContext } from "@/lib/services/answer-pipeline";
import { QUESTION_CATALOG } from "@/lib/question-engine/question-catalog";
import type { ResumeSection } from "@/types";

/** Real Spanish prose, so it tokenizes and splits like a genuine answer. */
const FILLER =
  "Atendía a los clientes en el mostrador, cobraba en la caja registradora, " +
  "organizaba la mercancía en los estantes, revisaba el inventario cada semana, " +
  "preparaba los pedidos para entrega, limpiaba el local al cerrar y contaba el " +
  "dinero al final del turno con mucho cuidado. ";

function pad(limit: number): string {
  let s = "";
  while (s.length < limit) s += FILLER;
  return s.slice(0, limit);
}

/** These carry decisions or no free text at all, so there is nothing to pad. */
const NO_FREE_TEXT = new Set(["skills_confirm", "review_summary", "experience_type_counts"]);

let store: MemoryStore;
let ctx: PipelineContext;
let profileId: string;

beforeEach(async () => {
  store = new MemoryStore();
  ctx = { store, ai: new MockAIProvider(), analytics: new NoopAnalytics(), userId: "u1" };
  profileId = (await store.createResumeProfile("u1", {})).id;
});

describe("every charLimit survives the pipeline", () => {
  for (const q of QUESTION_CATALOG) {
    if (NO_FREE_TEXT.has(q.id)) continue;
    it(`${q.id} accepts an answer of exactly ${q.charLimit} chars`, async () => {
      const rawAnswer = pad(q.charLimit);
      expect(rawAnswer).toHaveLength(q.charLimit);
      await expect(
        processAnswer(ctx, {
          profileId,
          questionId: q.id,
          section: q.section as ResumeSection,
          rawAnswer,
        }),
      ).resolves.toBeDefined();
    });
  }
});

/**
 * The same promise for RUN-ON prose. Both providers derive list fields
 * (relevantCoursework, responsibilities, tools …) by splitting the answer on
 * punctuation, so item length depends on how the person writes, not how much.
 * Someone who writes 400 characters without a comma produced a single oversized
 * segment and got "Datos inválidos" (422) on a perfectly valid answer — caught
 * by a live run of the improvement loop, fixed by `itemList` in lib/ai/schemas.ts.
 */
describe("every charLimit survives the pipeline — unpunctuated prose", () => {
  const RUN_ON =
    "estudié en la preparatoria federal y llevé clases de contabilidad básica y de " +
    "computación donde aprendí a usar hojas de cálculo y a redactar documentos y " +
    "también tomé un taller de manejo de alimentos que me sirvió mucho para el trabajo ";

  for (const q of QUESTION_CATALOG) {
    if (NO_FREE_TEXT.has(q.id)) continue;
    it(`${q.id} accepts ${q.charLimit} chars with no commas or periods`, async () => {
      let s = "";
      while (s.length < q.charLimit) s += RUN_ON;
      const rawAnswer = s.slice(0, q.charLimit);
      expect(rawAnswer).not.toMatch(/[.,;]/);
      await expect(
        processAnswer(ctx, {
          profileId,
          questionId: q.id,
          section: q.section as ResumeSection,
          rawAnswer,
        }),
      ).resolves.toBeDefined();
    });
  }
});

describe("repeated max-length answers", () => {
  it("accepts several maxed-out experience answers in a row", async () => {
    // The worst realistic case: a user describing many experiences at full length.
    const expQuestions = QUESTION_CATALOG.filter(
      (q) => q.section === "experience" && !NO_FREE_TEXT.has(q.id),
    );
    for (let i = 0; i < 3; i++) {
      for (const q of expQuestions) {
        await expect(
          processAnswer(ctx, {
            profileId,
            questionId: q.id,
            section: "experience",
            rawAnswer: pad(q.charLimit),
          }),
        ).resolves.toBeDefined();
      }
    }
    const skills = await store.listSkills(profileId);
    expect(skills.length).toBeGreaterThan(0);
    // Evidence is a citation, not a copy of the answer — it must stay well under
    // SuggestedSkillSchema's 400-char cap however long the answer was.
    for (const s of skills) {
      expect((s.evidence ?? "").length, s.name).toBeLessThanOrEqual(400);
    }
  });
});
