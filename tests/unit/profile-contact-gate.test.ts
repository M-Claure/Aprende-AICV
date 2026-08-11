/**
 * A résumé profile must never be persisted for someone we have no way to reach.
 * The gate lives in `CreateProfileBody`, so the route cannot reach a write
 * without a name and at least one contact channel (email and/or phone).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { assembleProfileState } from "@/lib/profile-state";
import { buildCandidates } from "@/lib/question-engine/question-prioritizer";
import { CreateProfileBody } from "@/lib/validation/api-schemas";
import {
  isEmail,
  isPhone,
  parseContact,
  parseFullName,
  parsePersonalInformation,
} from "@/lib/personal-contact";

const valid = { acceptTerms: true as const, fullName: "María García López" };

/** Field the first validation issue is attached to, for error-targeting checks. */
function issuePaths(body: unknown): string[] {
  const res = CreateProfileBody.safeParse(body);
  return res.success ? [] : res.error.issues.map((i) => i.path.join("."));
}

describe("CreateProfileBody — contact gate", () => {
  it("accepts an email as the only contact channel", () => {
    const parsed = CreateProfileBody.parse({ ...valid, email: "maria@example.com" });
    expect(parsed.email).toBe("maria@example.com");
    expect(parsed.phone).toBeUndefined();
  });

  it("accepts a phone number as the only contact channel", () => {
    const parsed = CreateProfileBody.parse({ ...valid, phone: "555 123 4567" });
    expect(parsed.phone).toBe("555 123 4567");
    expect(parsed.email).toBeUndefined();
  });

  it("accepts both channels together", () => {
    const parsed = CreateProfileBody.parse({
      ...valid,
      email: "maria@example.com",
      phone: "+52 55 1234 5678",
    });
    expect(parsed.email).toBe("maria@example.com");
    expect(parsed.phone).toBe("+52 55 1234 5678");
  });

  it("rejects both channels missing", () => {
    expect(issuePaths({ ...valid })).toContain("email");
  });

  it("rejects both channels blank", () => {
    expect(issuePaths({ ...valid, email: "   ", phone: "  " })).toContain("email");
  });

  it("rejects a malformed email and blames the email field", () => {
    expect(issuePaths({ ...valid, email: "no tengo" })).toEqual(["email"]);
  });

  it("rejects a malformed phone and blames the phone field", () => {
    expect(issuePaths({ ...valid, phone: "no tengo" })).toEqual(["phone"]);
  });

  it("rejects a typo in one channel even when the other is valid", () => {
    // Otherwise a mistyped address would be silently dropped from the résumé.
    expect(issuePaths({ ...valid, email: "maria@", phone: "555 123 4567" })).toEqual(["email"]);
    expect(issuePaths({ ...valid, email: "maria@example.com", phone: "12" })).toEqual(["phone"]);
  });

  it("does not try to read a phone number out of the email field", () => {
    // The old combined field guessed; separate fields validate each value whole.
    expect(issuePaths({ ...valid, email: "555 123 4567" })).toEqual(["email"]);
  });

  it("trims surrounding whitespace off both channels", () => {
    const parsed = CreateProfileBody.parse({ ...valid, email: "  maria@example.com  " });
    expect(parsed.email).toBe("maria@example.com");
  });

  it("still rejects a missing name", () => {
    expect(issuePaths({ acceptTerms: true, email: "a@b.com" })).toContain("fullName");
  });

  it("still rejects missing consent even with full contact details", () => {
    expect(issuePaths({ fullName: "Ana Ruiz", email: "ana@example.com" })).toContain("acceptTerms");
  });
});

describe("per-field validators", () => {
  it("accepts ordinary email addresses", () => {
    for (const v of ["maria@correo.com", "ana.ruiz+cv@sub.example.com.mx", " a@b.co "]) {
      expect(isEmail(v)).toBe(true);
    }
  });

  it("rejects near-misses and stray punctuation", () => {
    for (const v of ["maria@", "@correo.com", "maria@correo", "maria@correo.c", "a@b.com,", ""]) {
      expect(isEmail(v)).toBe(false);
    }
  });

  it("accepts phone numbers in the formats people type", () => {
    for (const v of ["5551234567", "555 123 4567", "(555) 123-4567", "+52 55 1234 5678"]) {
      expect(isPhone(v)).toBe(true);
    }
  });

  it("rejects too-short, too-long and non-numeric phones", () => {
    for (const v of ["12345", "1234567890123456", "no tengo", "maria@correo.com", ""]) {
      expect(isPhone(v)).toBe(false);
    }
  });
});

// Extraction is no longer on the create-profile path — it survives only for the
// funnel's single-box `personal_contact` question, reached by profiles that
// predate up-front capture.
describe("contact extraction (funnel fallback)", () => {
  it("splits an email out of free text", () => {
    expect(parseContact("maria@example.com")).toEqual({ email: "maria@example.com", phone: null });
  });

  it("does not read the digits inside an email as a phone number", () => {
    expect(parseContact("maria2024@example.com")).toEqual({
      email: "maria2024@example.com",
      phone: null,
    });
  });

  it("captures both channels when both are given, without trailing punctuation", () => {
    const { email, phone } = parseContact("maria@example.com, 555 123 4567");
    expect(email).toBe("maria@example.com");
    expect(phone).toBe("555 123 4567");
  });

  it("leaves a trailing period out of the email", () => {
    expect(parseContact("Escríbeme a maria@example.com.").email).toBe("maria@example.com");
  });

  it("keeps multi-label domains intact", () => {
    expect(parseContact("maria@correo.example.com.mx").email).toBe("maria@correo.example.com.mx");
  });

  it("finds nothing in text that carries no contact details", () => {
    expect(parseContact("María García")).toEqual({ email: null, phone: null });
  });

  it("splits a full name into given and family names", () => {
    expect(parseFullName("María García López")).toEqual({
      firstName: "María",
      lastName: "García López",
    });
    expect(parseFullName("Ana")).toEqual({ firstName: "Ana", lastName: null });
  });

  it("parses a combined name-plus-contact answer (the funnel's shape)", () => {
    expect(parsePersonalInformation("María García López maria@example.com")).toEqual({
      firstName: "María",
      lastName: "García López",
      email: "maria@example.com",
      phone: null,
    });
  });
});

describe("funnel after up-front capture", () => {
  let store: MemoryStore;
  let profileId: string;

  beforeEach(async () => {
    store = new MemoryStore();
    const profile = await store.createResumeProfile("user-1", {
      status: "collecting_information",
      currentSection: "career_goal",
    });
    profileId = profile.id;
    // What the create-profile route now writes alongside the profile row.
    await store.upsertPersonalInformation(profileId, {
      firstName: "María",
      lastName: "García López",
      email: "maria@example.com",
      phone: null,
    });
  });

  it("no longer offers the name or contact questions", async () => {
    const state = await assembleProfileState(store, profileId);
    const ids = buildCandidates(state).map((c) => c.questionId);
    expect(ids).not.toContain("personal_name");
    expect(ids).not.toContain("personal_contact");
  });

  it("no longer lists the name or contact as missing critical fields", async () => {
    const state = await assembleProfileState(store, profileId);
    expect(state.personalInformation.firstName).toBe("María");
    expect(state.personalInformation.hasEmail).toBe(true);
    const missing = state.completeness.missingCriticalFields.map((f) => f.field);
    expect(missing).not.toContain("contact");
    expect(missing).not.toContain("firstName");
  });

  it("keeps asking for the career goal, which up-front capture does not cover", async () => {
    const state = await assembleProfileState(store, profileId);
    const ids = buildCandidates(state).map((c) => c.questionId);
    expect(ids.some((id) => id.startsWith("career_goal"))).toBe(true);
  });

  it("does not mark the profile ready to generate on contact alone", async () => {
    const state = await assembleProfileState(store, profileId);
    expect(state.completeness.readyToGenerate).toBe(false);
  });

  // Guards the MockAIProvider refactor: the funnel's combined answer must keep
  // producing the same fields now that it shares lib/personal-contact.
  it("still captures name and contact from a single funnel answer", async () => {
    const ai = new MockAIProvider();
    const state = await assembleProfileState(store, profileId);
    const norm = await ai.normalizeAnswer({
      questionId: "personal_contact",
      section: "personal_information",
      questionText: "¿Cuál es tu correo electrónico o número de teléfono?",
      rawAnswer: "Ana Ruiz ana@example.com",
      state,
    });
    expect(norm.updates.personalInformation).toMatchObject({
      firstName: "Ana",
      lastName: "Ruiz",
      email: "ana@example.com",
    });
  });
});
