/**
 * The Review screen shows a live "used / limit" counter under every field. That
 * number is only useful if it is the SAME number the API enforces — a counter
 * that says "fits" against a server that returns 422 is worse than no counter.
 *
 * These tests pin the two together: for every field, a value exactly at the
 * advertised limit is accepted and one character more is rejected. They fail if
 * someone re-hardcodes a bound in the Zod schema without moving the constant.
 */
import { describe, expect, it } from "vitest";
import { REVIEW_FIELD_CHAR_LIMITS as LIMITS } from "@/lib/answer-limits";
import {
  AddSkillsBody,
  CreateEducationBody,
  CreateExperienceBody,
  PatchPersonalInfoBody,
  SetInterestsBody,
  UpdateAchievementBody,
  UpdateCertificationBody,
  UpdateLanguageBody,
  UpdateProjectBody,
} from "@/lib/validation/api-schemas";

/** `n` non-space characters, so `.trim()` in the schema chain can't shorten it. */
const chars = (n: number) => "a".repeat(n);

type Case = { label: string; limit: number; build: (v: string) => unknown; schema: { safeParse: (i: unknown) => { success: boolean } } };

const cases: Case[] = [
  // ── Personal information ──
  { label: "firstName", limit: LIMITS.firstName, schema: PatchPersonalInfoBody, build: (v) => ({ firstName: v }) },
  { label: "lastName", limit: LIMITS.lastName, schema: PatchPersonalInfoBody, build: (v) => ({ lastName: v }) },
  { label: "city", limit: LIMITS.city, schema: PatchPersonalInfoBody, build: (v) => ({ city: v }) },
  { label: "country", limit: LIMITS.country, schema: PatchPersonalInfoBody, build: (v) => ({ country: v }) },
  { label: "email", limit: LIMITS.email, schema: PatchPersonalInfoBody, build: (v) => ({ email: v }) },
  { label: "phone", limit: LIMITS.phone, schema: PatchPersonalInfoBody, build: (v) => ({ phone: v }) },
  // ── Education ──
  { label: "institution", limit: LIMITS.institution, schema: CreateEducationBody, build: (v) => ({ institution: v }) },
  { label: "credential", limit: LIMITS.credential, schema: CreateEducationBody, build: (v) => ({ credential: v }) },
  { label: "fieldOfStudy", limit: LIMITS.fieldOfStudy, schema: CreateEducationBody, build: (v) => ({ fieldOfStudy: v }) },
  { label: "endDate", limit: LIMITS.date, schema: CreateEducationBody, build: (v) => ({ endDate: v }) },
  // ── Experience ──
  {
    label: "title",
    limit: LIMITS.title,
    schema: CreateExperienceBody,
    build: (v) => ({ experienceType: "formal_employment", title: v }),
  },
  {
    label: "organization",
    limit: LIMITS.organization,
    schema: CreateExperienceBody,
    build: (v) => ({ experienceType: "formal_employment", organization: v }),
  },
  {
    label: "peopleServed",
    limit: LIMITS.peopleServed,
    schema: CreateExperienceBody,
    build: (v) => ({ experienceType: "formal_employment", peopleServed: v }),
  },
  {
    label: "startDate",
    limit: LIMITS.date,
    schema: CreateExperienceBody,
    build: (v) => ({ experienceType: "formal_employment", startDate: v }),
  },
  // ── Projects / certifications / languages / achievements ──
  { label: "project name", limit: LIMITS.entryName, schema: UpdateProjectBody, build: (v) => ({ name: v }) },
  {
    label: "project organization",
    limit: LIMITS.organization,
    schema: UpdateProjectBody,
    build: (v) => ({ organization: v }),
  },
  {
    label: "certification name",
    limit: LIMITS.entryName,
    schema: UpdateCertificationBody,
    build: (v) => ({ name: v }),
  },
  {
    label: "certification issueDate",
    limit: LIMITS.date,
    schema: UpdateCertificationBody,
    build: (v) => ({ issueDate: v }),
  },
  { label: "language name", limit: LIMITS.languageName, schema: UpdateLanguageBody, build: (v) => ({ name: v }) },
  {
    label: "achievement title",
    limit: LIMITS.entryName,
    schema: UpdateAchievementBody,
    build: (v) => ({ title: v }),
  },
  {
    label: "achievement date",
    limit: LIMITS.date,
    schema: UpdateAchievementBody,
    build: (v) => ({ date: v }),
  },
  // ── List items: the cap is per entry, which is what the UI reports ──
  { label: "skillName", limit: LIMITS.skillName, schema: AddSkillsBody, build: (v) => ({ names: [v] }) },
  { label: "interest", limit: LIMITS.interest, schema: SetInterestsBody, build: (v) => ({ interests: [v] }) },
];

describe("Review field limits match what the API accepts", () => {
  for (const { label, limit, build, schema } of cases) {
    it(`${label}: accepts exactly ${limit} characters`, () => {
      expect(schema.safeParse(build(chars(limit))).success).toBe(true);
    });

    it(`${label}: rejects ${limit + 1} characters`, () => {
      expect(schema.safeParse(build(chars(limit + 1))).success).toBe(false);
    });
  }
});

describe("limits are sane", () => {
  it("every advertised limit is a positive integer", () => {
    for (const [field, limit] of Object.entries(LIMITS)) {
      expect(Number.isInteger(limit), `${field} must be an integer`).toBe(true);
      expect(limit, `${field} must be positive`).toBeGreaterThan(0);
    }
  });

  it("free-text dates stay short enough to be a date, long enough for a range", () => {
    // "de marzo 2020 a la actualidad" is 29 characters.
    expect(LIMITS.date).toBeGreaterThanOrEqual(40);
    expect(LIMITS.date).toBeLessThanOrEqual(100);
  });
});
