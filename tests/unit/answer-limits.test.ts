/**
 * Answers are length-capped to bound Anthropic spend. The limit must be resolved
 * from the catalog server-side (never from the request), and the client table
 * must agree with the server so a user can't be shown a field that accepts more
 * than the API will take.
 */
import { describe, expect, it } from "vitest";
import {
  ANSWER_CHAR_LIMITS,
  CONTACT_FIELD_CHAR_LIMITS,
  DEFAULT_ANSWER_CHAR_LIMIT,
  ENTRY_TEXT_CHAR_LIMIT,
  LIST_ITEM_CHAR_LIMIT,
  LIST_MAX_ITEMS,
  answerCharLimit,
  answerCharLimitForQuestion,
} from "@/lib/answer-limits";
import { INPUT_TYPES } from "@/lib/ai/schemas";
import { QUESTION_CATALOG } from "@/lib/question-engine/question-catalog";
import { AnswerBody, CreateExperienceBody, CreateProfileBody } from "@/lib/validation/api-schemas";

const chars = (n: number) => "a".repeat(n);

describe("limit table", () => {
  it("covers every input type the planner can emit", () => {
    for (const t of INPUT_TYPES) {
      expect(ANSWER_CHAR_LIMITS[t], t).toBeGreaterThan(0);
    }
  });

  it("gives every catalog question its own declared limit", () => {
    for (const q of QUESTION_CATALOG) {
      expect(q.charLimit, q.id).toBeGreaterThan(0);
      expect(answerCharLimitForQuestion(q.id), q.id).toBe(q.charLimit);
    }
  });

  it("gives narrative questions far more room than identity questions", () => {
    // The whole point of per-question limits: an experience cannot be described
    // in the space a name needs.
    const limit = (id: string) => answerCharLimitForQuestion(id);
    for (const narrative of [
      "experience_add",
      "experience_daily_tasks",
      "projects_any",
      "education_details",
    ]) {
      expect(limit(narrative), narrative).toBeGreaterThanOrEqual(400);
      expect(limit(narrative), narrative).toBeGreaterThan(limit("personal_name") * 4);
    }
  });

  it("keeps single-fact questions tight", () => {
    expect(answerCharLimitForQuestion("personal_name")).toBeLessThanOrEqual(80);
    expect(answerCharLimitForQuestion("education_dates")).toBeLessThanOrEqual(60);
    expect(answerCharLimitForQuestion("career_goal_target")).toBeLessThanOrEqual(100);
  });

  it("falls back to the generous default for unknown questions", () => {
    // Analyzer-generated follow-ups are not in the catalog.
    expect(answerCharLimitForQuestion("no_such_question")).toBe(DEFAULT_ANSWER_CHAR_LIMIT);
    expect(answerCharLimit(undefined)).toBe(DEFAULT_ANSWER_CHAR_LIMIT);
    expect(DEFAULT_ANSWER_CHAR_LIMIT).toBe(ANSWER_CHAR_LIMITS.long_text);
  });

  it("keeps narrative answers well under the old blanket 5000 ceiling", () => {
    expect(ANSWER_CHAR_LIMITS.long_text).toBeLessThan(5000 / 4);
  });
});

describe("AnswerBody — per-question enforcement", () => {
  const base = { questionId: "experience_add", section: "experience" as const };

  it("accepts a narrative answer at exactly the limit", () => {
    const limit = answerCharLimitForQuestion("experience_add");
    expect(AnswerBody.safeParse({ ...base, rawAnswer: chars(limit) }).success).toBe(true);
  });

  it("rejects one character past the limit, blaming rawAnswer", () => {
    const limit = answerCharLimitForQuestion("experience_add");
    const res = AnswerBody.safeParse({ ...base, rawAnswer: chars(limit + 1) });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.map((i) => i.path.join("."))).toContain("rawAnswer");
      expect(res.error.issues[0]?.message).toContain(String(limit));
    }
  });

  it("applies each question's own limit, not a shared one", () => {
    const nameLimit = answerCharLimitForQuestion("personal_name");
    const body = { questionId: "personal_name", section: "personal_information" as const };
    expect(AnswerBody.safeParse({ ...body, rawAnswer: chars(nameLimit) }).success).toBe(true);
    expect(AnswerBody.safeParse({ ...body, rawAnswer: chars(nameLimit + 1) }).success).toBe(false);
    // The same length sails through on the experience question.
    expect(
      AnswerBody.safeParse({
        questionId: "experience_add",
        section: "experience",
        rawAnswer: chars(nameLimit + 1),
      }).success,
    ).toBe(true);
  });

  it("does not let a request pick its own limit", () => {
    // An experience-sized answer on the name question is still held to the name
    // limit, whatever else the body claims.
    const res = AnswerBody.safeParse({
      questionId: "personal_name",
      section: "personal_information",
      rawAnswer: chars(answerCharLimitForQuestion("experience_add")),
      inputType: "long_text",
      charLimit: 5000,
    });
    expect(res.success).toBe(false);
  });

  it("ignores the limit for a skip, which carries no answer", () => {
    expect(AnswerBody.safeParse({ ...base, skipped: true }).success).toBe(true);
  });

  it("measures the trimmed answer, so trailing whitespace can't trip it", () => {
    const limit = answerCharLimitForQuestion("experience_add");
    const padded = `${chars(limit)}${" ".repeat(50)}`;
    expect(AnswerBody.safeParse({ ...base, rawAnswer: padded }).success).toBe(true);
  });
});

describe("stored entry text — the back door", () => {
  it("caps narrative entry text at the long_text limit", () => {
    expect(ENTRY_TEXT_CHAR_LIMIT).toBe(ANSWER_CHAR_LIMITS.long_text);
    const ok = CreateExperienceBody.safeParse({
      experienceType: "other",
      rawDescription: chars(ENTRY_TEXT_CHAR_LIMIT),
    });
    expect(ok.success).toBe(true);
    const tooLong = CreateExperienceBody.safeParse({
      experienceType: "other",
      rawDescription: chars(ENTRY_TEXT_CHAR_LIMIT + 1),
    });
    expect(tooLong.success).toBe(false);
  });

  it("bounds bullet lists by item length and item count", () => {
    const field = (items: string[]) => ({ experienceType: "other" as const, responsibilities: items });
    expect(CreateExperienceBody.safeParse(field([chars(LIST_ITEM_CHAR_LIMIT)])).success).toBe(true);
    expect(CreateExperienceBody.safeParse(field([chars(LIST_ITEM_CHAR_LIMIT + 1)])).success).toBe(false);
    expect(
      CreateExperienceBody.safeParse(field(Array.from({ length: LIST_MAX_ITEMS }, () => "tarea")))
        .success,
    ).toBe(true);
    expect(
      CreateExperienceBody.safeParse(field(Array.from({ length: LIST_MAX_ITEMS + 1 }, () => "tarea")))
        .success,
    ).toBe(false);
  });
});

describe("contact step limits", () => {
  it("fits the real-world values people actually type", () => {
    // Sized deliberately above the shortest plausible caps: Spanish naming and
    // company email domains both run longer than a first guess suggests.
    const cases: Array<[keyof typeof CONTACT_FIELD_CHAR_LIMITS, string]> = [
      ["fullName", "María del Carmen Rodríguez Hernández"],
      ["email", "maria.rodriguez@aprendeinstitute.com"],
      ["phone", "+52 55 1234 5678"],
    ];
    for (const [field, value] of cases) {
      expect(value.length, `${field} sample`).toBeLessThanOrEqual(CONTACT_FIELD_CHAR_LIMITS[field]);
    }
  });

  it("is enforced by CreateProfileBody at the same numbers the form counts", () => {
    const base = { acceptTerms: true as const, email: "a@b.com" };
    const atLimit = chars(CONTACT_FIELD_CHAR_LIMITS.fullName);
    expect(CreateProfileBody.safeParse({ ...base, fullName: atLimit }).success).toBe(true);
    expect(CreateProfileBody.safeParse({ ...base, fullName: `${atLimit}a` }).success).toBe(false);

    const longPhone = chars(CONTACT_FIELD_CHAR_LIMITS.phone + 1);
    expect(
      CreateProfileBody.safeParse({ acceptTerms: true, fullName: "Ana", phone: longPhone }).success,
    ).toBe(false);
  });
});
