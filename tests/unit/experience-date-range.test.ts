/**
 * The funnel asks for both ends of an experience's dates in ONE question ("de
 * marzo 2020 a la actualidad"), and that question is deliberately never sent to
 * the model (`MECHANICAL_QUESTION_IDS`). So the deterministic split is the only
 * thing standing between what the person said and what Review shows.
 *
 * It used to write the whole answer to `startDate`, which left `endDate` null on
 * every experience the funnel had ever captured — and the required-field rule then
 * asked for an end date the person had already given, with the generate button
 * disabled until they retyped it. These tests pin both halves: the split itself,
 * and the fact that a funnel-captured experience satisfies the rule.
 */
import { describe, expect, it } from "vitest";
import {
  effectiveExperienceDates,
  formatExperienceDate,
  parseExperienceDateRange,
} from "@/lib/experience-dates";
import { missingExperienceFields, experienceRequiredValues } from "@/lib/entry-required-fields";
import { experienceRecency } from "@/lib/resume/experience-order";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { NoopAnalytics } from "@/lib/analytics";
import { processAnswer, type PipelineContext } from "@/lib/services/answer-pipeline";

describe("splitting one free-text answer into a range", () => {
  it("reads the shape the question's own example uses", () => {
    expect(parseExperienceDateRange("de marzo 2020 a la actualidad")).toEqual({
      start: { month: "3", year: "2020" },
      end: { month: "", year: "" },
      isCurrent: true,
    });
  });

  it("reads a closed range, taking the last date as the end", () => {
    expect(parseExperienceDateRange("de junio 2018 a marzo 2021")).toEqual({
      start: { month: "6", year: "2018" },
      end: { month: "3", year: "2021" },
      isCurrent: false,
    });
    expect(parseExperienceDateRange("de 2019 a 2021")).toEqual({
      start: { month: "", year: "2019" },
      end: { month: "", year: "2021" },
      isCurrent: false,
    });
  });

  it("treats one date as a start with no end, not as a range", () => {
    expect(parseExperienceDateRange("marzo 2020")).toEqual({
      start: { month: "3", year: "2020" },
      end: { month: "", year: "" },
      isCurrent: false,
    });
  });

  it("does not read a bare year twice out of 'mes año'", () => {
    // "marzo 2020" must not yield both "marzo 2020" and "2020", which would look
    // like a range that ends the same month it starts.
    const r = parseExperienceDateRange("marzo 2020");
    expect(r.end).toEqual({ month: "", year: "" });
  });

  it("comes back empty rather than guessing", () => {
    expect(parseExperienceDateRange("hace unos años")).toEqual({
      start: { month: "", year: "" },
      end: { month: "", year: "" },
      isCurrent: false,
    });
    expect(parseExperienceDateRange(null).start.year).toBe("");
  });

  it("ignores a number that is not a plausible year", () => {
    expect(parseExperienceDateRange("como 20 clientes").start.year).toBe("");
  });

  it("round-trips every month the Review dropdown can produce", () => {
    for (let m = 1; m <= 12; m++) {
      const stored = formatExperienceDate(String(m), "2021");
      expect(parseExperienceDateRange(stored).start).toEqual({ month: String(m), year: "2021" });
    }
  });
});

describe("reading a stored entry's dates", () => {
  it("recovers the end from a range the funnel left on startDate", () => {
    const dates = effectiveExperienceDates({
      startDate: "de marzo 2020 a la actualidad",
      endDate: null,
      isCurrent: false,
    });
    expect(dates).toEqual({
      start: { month: "3", year: "2020" },
      end: { month: "", year: "" },
      isCurrent: true,
    });
  });

  it("lets an explicitly stored end date win over prose", () => {
    const dates = effectiveExperienceDates({
      startDate: "de marzo 2020 a la actualidad",
      endDate: "enero 2022",
      isCurrent: false,
    });
    expect(dates.end).toEqual({ month: "1", year: "2022" });
    expect(dates.isCurrent).toBe(false);
  });

  it("lets an explicit 'sigo aquí' win, and keeps the end empty", () => {
    const dates = effectiveExperienceDates({
      startDate: "marzo 2020",
      endDate: "enero 2022",
      isCurrent: true,
    });
    expect(dates.isCurrent).toBe(true);
    expect(dates.end).toEqual({ month: "", year: "" });
  });

  it("still reports no end when there genuinely is none", () => {
    const dates = effectiveExperienceDates({ startDate: "marzo 2020", endDate: null, isCurrent: false });
    expect(dates.end.year).toBe("");
    expect(dates.isCurrent).toBe(false);
  });
});

describe("the required-field rule accepts a funnel-captured date", () => {
  const entry = (startDate: string, endDate: string | null) => ({
    title: "Cuidadora",
    organization: "Casa de mi abuela",
    startDate,
    endDate,
    isCurrent: false,
    rawDescription: "Cuidé a mi abuela",
    responsibilities: [] as string[],
  });

  it("no longer demands an end date the person already gave", () => {
    const v = experienceRequiredValues(entry("de marzo 2020 a la actualidad", null));
    expect(v.isCurrent).toBe(true);
    expect(missingExperienceFields(v)).toEqual([]);
  });

  it("accepts a closed range stored on startDate", () => {
    const v = experienceRequiredValues(entry("de junio 2018 a marzo 2021", null));
    expect(v.endYear).toBe("2021");
    expect(missingExperienceFields(v)).toEqual([]);
  });

  it("still asks when only a start is known", () => {
    expect(missingExperienceFields(experienceRequiredValues(entry("marzo 2020", null)))).toEqual([
      "endDate",
    ]);
  });
});

describe("end to end: the funnel's own date answer", () => {
  it("leaves an experience whose dates satisfy Review and order the résumé", async () => {
    const store = new MemoryStore();
    const ctx: PipelineContext = {
      store,
      ai: new MockAIProvider(),
      analytics: new NoopAnalytics(),
      userId: "u1",
    };
    const profile = await store.createResumeProfile("u1", { targetRole: "Recepcionista" });

    await processAnswer(ctx, {
      profileId: profile.id,
      questionId: "experience_type_counts",
      section: "experience",
      rawAnswer: JSON.stringify({ caregiving: 1 }),
    });
    await processAnswer(ctx, {
      profileId: profile.id,
      questionId: "experience_add",
      section: "experience",
      rawAnswer: "Cuidé a mi abuela durante tres años en su casa",
    });
    await processAnswer(ctx, {
      profileId: profile.id,
      questionId: "experience_dates",
      section: "experience",
      rawAnswer: "de marzo 2020 a la actualidad",
    });

    const stored = (await store.listExperience(profile.id))[0]!;
    // The two ends are now separate fields, so the résumé prints "Marzo 2020 –
    // Actualidad" instead of the whole phrase as a start date.
    expect(stored.startDate).toBe("marzo 2020");
    expect(stored.isCurrent).toBe(true);
    expect(stored.endDate).toBe("");

    // The dates no longer block the Review screen…
    const missing = missingExperienceFields(experienceRequiredValues(stored));
    expect(missing).not.toContain("startDate");
    expect(missing).not.toContain("endDate");
    // …and an ongoing entry still outranks every dated one when ordering.
    expect(experienceRecency(stored)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("keeps an unparseable answer verbatim on startDate", async () => {
    const store = new MemoryStore();
    const ctx: PipelineContext = {
      store,
      ai: new MockAIProvider(),
      analytics: new NoopAnalytics(),
      userId: "u1",
    };
    const profile = await store.createResumeProfile("u1", { targetRole: "Recepcionista" });
    await processAnswer(ctx, {
      profileId: profile.id,
      questionId: "experience_add",
      section: "experience",
      rawAnswer: "Ayudaba en la tienda",
    });
    await processAnswer(ctx, {
      profileId: profile.id,
      questionId: "experience_dates",
      section: "experience",
      rawAnswer: "hace muchos años",
    });

    const stored = (await store.listExperience(profile.id))[0]!;
    expect(stored.startDate).toBe("hace muchos años");
  });
});
