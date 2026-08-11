import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * API-level e2e helpers. The React UI is out of scope for this milestone, so the
 * major flows are driven through the HTTP API (server booted in mock/memory mode
 * by playwright.config.ts). Each test uses its own profile id for isolation.
 */
/**
 * Consent, a name and at least one contact channel are required before the
 * profile row is written, so every helper-created profile supplies them.
 */
export async function createProfile(request: APIRequestContext): Promise<string> {
  const res = await request.post("/api/resume-profiles", {
    data: { acceptTerms: true, fullName: "María García López", email: "maria@ejemplo.com" },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return body.data.profile.id;
}

export interface AnswerResult {
  state: any;
  nextQuestion: any;
  interpretation: any;
  suggestedSkills: any[];
}

export async function answer(
  request: APIRequestContext,
  profileId: string,
  payload: {
    questionId: string;
    section: string;
    rawAnswer?: string;
    skipped?: boolean;
    skillDecisions?: { confirm?: string[]; reject?: string[] };
  },
): Promise<AnswerResult> {
  const res = await request.post(`/api/resume-profiles/${profileId}/answers`, { data: payload });
  expect(res.status(), `answer ${payload.questionId}`).toBe(200);
  return (await res.json()).data as AnswerResult;
}

export async function completeness(request: APIRequestContext, profileId: string) {
  const res = await request.get(`/api/resume-profiles/${profileId}/completeness`);
  expect(res.status()).toBe(200);
  return (await res.json()).data.completeness;
}
