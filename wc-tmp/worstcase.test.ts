/**
 * Worst-case cost run: drive the real funnel with every answer padded to its
 * exact charLimit, then exhaust MAX_RESUME_ITERATIONS.
 *
 * Uses the REAL AzureOpenAIProvider (so token counts and cost are actual) but a
 * MemoryStore, so nothing is written to Supabase. Run via vitest to inherit the
 * `@/` alias and the `server-only` stub.
 */
import { it } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { AzureOpenAIProvider } from "@/lib/ai/azure-openai-provider";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { HybridAIProvider } from "@/lib/ai/hybrid-provider";
import { processAnswer } from "@/lib/services/answer-pipeline";
import { generateResume } from "@/lib/resume/resume-generator";
import { analyzeResume } from "@/lib/resume/resume-analyzer";
import { proofreadAndRerender } from "@/lib/resume/proofread-resume";
import { assembleProfileState } from "@/lib/profile-state";
import { QUESTION_CATALOG, getCatalogQuestion } from "@/lib/question-engine/question-catalog";
import { MAX_RESUME_ITERATIONS } from "@/lib/config/limits";
import { CONTACT_FIELD_CHAR_LIMITS } from "@/lib/answer-limits";
import type { ResumeSection } from "@/types";

/**
 * Realistic Spanish filler padded to EXACTLY `limit` characters. Real prose, not
 * repeated "aaaa" — a repeated character compresses into far fewer tokens and
 * would understate the cost.
 */
const FILLER =
  "Atendía a los clientes en el mostrador, cobraba en la caja registradora, " +
  "organizaba la mercancía en los estantes, revisaba el inventario cada semana, " +
  "preparaba los pedidos para entrega, limpiaba el local al cerrar, coordinaba " +
  "horarios con mis compañeras, resolvía quejas de clientes con paciencia, " +
  "contaba el dinero al final del turno y ayudaba a capacitar al personal nuevo. ";

function pad(limit: number): string {
  let s = "";
  while (s.length < limit) s += FILLER;
  return s.slice(0, limit);
}

it("worst case cost run", async () => {
  const API_KEY = process.env.AZURE_OPENAI_API_KEY;
  const BASE_URL = process.env.AZURE_OPENAI_BASE_URL;
  const MODEL = process.env.AZURE_OPENAI_MODEL ?? "gpt-5.3-codex";
  if (!API_KEY) throw new Error("AZURE_OPENAI_API_KEY not set");
  if (!BASE_URL) throw new Error("AZURE_OPENAI_BASE_URL not set");
  const EXPERIENCES = Number(process.env.WC_EXPERIENCES ?? 5);

  const DRY = process.env.WC_DRY === "1";
  const mock = new MockAIProvider();
  const capable = DRY ? mock : new AzureOpenAIProvider(API_KEY, BASE_URL, MODEL);
  const funnelAi = DRY ? mock : new HybridAIProvider(capable, mock);
  console.log(DRY ? "[mode] DRY RUN — mock provider, no API cost" : `[mode] REAL — ${MODEL}`);
  const store = new MemoryStore();
  const analytics = { track() {}, identify() {} } as never;

  const t0 = Date.now();
  const profile = await store.createResumeProfile("worstcase-user", {
    status: "collecting_information",
    currentSection: "career_goal",
  });
  const profileId = profile.id;

  // The up-front contact step, at its limits.
  await store.upsertPersonalInformation(profileId, {
    firstName: "María del Carmen",
    lastName: pad(CONTACT_FIELD_CHAR_LIMITS.fullName - 17),
    email: "maria.rodriguez.hernandez@aprendeinstitute.com",
    phone: "+52 55 1234 5678",
  });

  const ctx = { store, ai: funnelAi, analytics, userId: "worstcase-user" };
  let answerCount = 0;
  let answerChars = 0;

  const failures: string[] = [];
  async function answer(questionId: string, section: ResumeSection, raw: string) {
    try {
      await processAnswer(ctx, { profileId, questionId, section, rawAnswer: raw });
      answerCount += 1;
      answerChars += raw.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message.replace(/\s+/g, " ").slice(0, 240) : String(err);
      failures.push(`${questionId} (${raw.length} chars): ${msg}`);
    }
  }

  // Questions that carry no free-text answer.
  const skip = new Set(["skills_confirm", "review_summary", "experience_type_counts"]);

  // 1. Every non-experience question, at exactly its charLimit.
  for (const q of QUESTION_CATALOG) {
    if (skip.has(q.id) || q.section === "experience") continue;
    await answer(q.id, q.section, pad(q.charLimit));
  }

  // 2. N experiences, each with every experience question at its limit.
  const expQuestions = QUESTION_CATALOG.filter(
    (q) => q.section === "experience" && !skip.has(q.id),
  ).map((q) => q.id);
  for (let i = 0; i < EXPERIENCES; i++) {
    for (const id of expQuestions) {
      await answer(id, "experience", pad(getCatalogQuestion(id)!.charLimit));
    }
  }

  if (failures.length > 0) {
    console.log(`\n[FAILURES] ${failures.length} answer(s) at their own charLimit were rejected:`);
    for (const f of failures) console.log(`  - ${f}`);
  } else {
    console.log("\n[ok] every answer at its charLimit was accepted");
  }

  const state = await assembleProfileState(store, profileId);
  console.log(
    `\n[profile] answers=${answerCount} answerChars=${answerChars} ` +
      `experiences=${state.experience.length} educ=${state.education.length} ` +
      `ready=${state.completeness.readyToGenerate}`,
  );

  // Generation reads confirmed skills only — confirm everything inferred.
  const skills = await store.listSkills(profileId);
  for (const s of skills) await store.updateSkill(s.id, { status: "confirmed" });
  console.log(`[profile] skills confirmed=${skills.length}`);

  console.log("\n=== GENERATE (initial) ===");
  await generateResume(store, capable, profileId);

  for (let i = 1; i <= MAX_RESUME_ITERATIONS; i++) {
    console.log(`\n=== ITERATION ${i}/${MAX_RESUME_ITERATIONS}: analyze + regenerate ===`);
    await analyzeResume(store, capable, profileId);
    await generateResume(store, capable, profileId);
  }

  console.log("\n=== PROOFREAD (finalize) ===");
  await proofreadAndRerender(store, capable, profileId);

  console.log(`\n[done] wall clock ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}, 900_000);
