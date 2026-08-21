import { describe, expect, it } from "vitest";
import { buildCandidates } from "@/lib/question-engine/question-prioritizer";
import { QUESTION_CATALOG, getCatalogQuestion } from "@/lib/question-engine/question-catalog";
import { planNextQuestion } from "@/lib/question-engine/adaptive-planner";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import type { ResumeProfileState } from "@/types";
import { completenessInput, educationState, experienceState, personalState, profileState, readyProfile, skillState } from "../helpers/factories";

function state(overrides = {}): ResumeProfileState {
  return profileState(overrides);
}

const provider = new MockAIProvider();
const ids = (s: ResumeProfileState) => buildCandidates(s).map((c) => c.questionId);

describe("buildCandidates — ordering & preconditions", () => {
  it("leads with the career goal for an empty profile", () => {
    expect(ids(state())[0]).toBe("career_goal_target");
  });

  it("surfaces education before experience for a low-experience user", () => {
    const s = state({
      careerGoal: "Diseñadora",
      personalInformation: personalState({ firstName: "Rosa", hasEmail: true }),
    });
    const order = ids(s);
    expect(order[0]).toBe("education_highest");
  });

  it("offers skill confirmation when suggestions are pending", () => {
    const s = state({
      careerGoal: "Vendedor",
      personalInformation: personalState({ firstName: "Ana", hasEmail: true }),
      education: [educationState({ institution: "Colegio", credential: "Secundaria" })],
      suggestedSkills: [skillState({ name: "Ventas", status: "suggested" })],
    });
    expect(ids(s)).toContain("skills_confirm");
  });
});

describe("buildCandidates — no repeats (spec §7)", () => {
  it("does not re-offer an answered, non-repeatable question", () => {
    const s = state({
      careerGoal: "Diseñadora",
      answeredQuestionIds: ["career_goal_target"],
    });
    expect(ids(s)).not.toContain("career_goal_target");
  });

  it("still offers a repeatable question after it was answered", () => {
    // experience_add repeats to describe each experience. One is described,
    // another is still empty (e.g. created by the type-counts step), so the
    // describe step must reappear even though it was already answered once.
    const s = state({
      careerGoal: "Diseñadora",
      personalInformation: personalState({ firstName: "Rosa", hasEmail: true }),
      education: [educationState({ institution: "Instituto", credential: "Técnico" })],
      experience: [
        experienceState({ responsibilities: ["Diseñaba folletos"] }),
        experienceState({ responsibilities: [] }),
      ],
      answeredQuestionIds: ["experience_add"],
    });
    expect(ids(s)).toContain("experience_add");
  });
});

describe("buildCandidates — skip behavior (spec §7)", () => {
  it("does not immediately re-ask a skipped optional question", () => {
    const s = state({
      careerGoal: "Diseñadora",
      personalInformation: personalState({ firstName: "Rosa", hasEmail: true }),
      education: [educationState({ institution: "Instituto", credential: "Técnico" })],
      skippedQuestionIds: ["experience_add"],
    });
    expect(ids(s)).not.toContain("experience_add");
  });

  it("re-asks a skipped CRITICAL question while the profile is not ready", () => {
    // career goal is critical; skipping it must not permanently remove it.
    const s = state({ skippedQuestionIds: ["career_goal_target"] });
    expect(ids(s)).toContain("career_goal_target");
  });
});

describe("experience questions are never skippable", () => {
  it("no experience catalog question offers a skip", () => {
    const skippable = QUESTION_CATALOG.filter((q) => q.section === "experience" && q.allowSkip);
    expect(skippable.map((q) => q.id)).toEqual([]);
  });

  it("still allows skipping questions outside the experience section", () => {
    // Guards against a blanket allowSkip:false sweep — optional sections keep it.
    expect(getCatalogQuestion("certifications_any")?.allowSkip).toBe(true);
    expect(getCatalogQuestion("personal_location")?.allowSkip).toBe(true);
  });

  it("planNextQuestion reports allowSkip:false for the counter step", async () => {
    const s = state({
      careerGoal: "Recepcionista",
      personalInformation: personalState({ firstName: "Rosa", hasEmail: true }),
      education: [educationState({ institution: "Instituto", credential: "Técnico" })],
    });
    const q = await planNextQuestion(s, provider);
    expect(q.section).toBe("experience");
    expect(q.allowSkip).toBe(false);
  });

  it("stops asking about experience once the person answered the counter with none", () => {
    // "Todo en 0" is the escape hatch that replaces the missing skip button; the
    // describe question must not then trap them on an experience they don't have.
    const s = state({
      careerGoal: "Recepcionista",
      personalInformation: personalState({ firstName: "Rosa", hasEmail: true }),
      education: [educationState({ institution: "Instituto", credential: "Técnico" })],
      experience: [],
      answeredQuestionIds: ["experience_type_counts"],
    });
    const order = ids(s);
    expect(order).not.toContain("experience_add");
    expect(order).not.toContain("experience_type_counts");
    expect(order.length).toBeGreaterThan(0); // the funnel still has somewhere to go
  });

  it("keeps offering the describe step while an entry is still undescribed", () => {
    const s = state({
      careerGoal: "Recepcionista",
      personalInformation: personalState({ firstName: "Rosa", hasEmail: true }),
      experience: [experienceState({ responsibilities: [], rawDescription: null })],
      answeredQuestionIds: ["experience_type_counts"],
    });
    expect(ids(s)).toContain("experience_add");
  });
});

describe("buildCandidates — stop when sufficient (spec §7)", () => {
  it("steers a ready profile toward review instead of optional questions", () => {
    const s = state(readyProfile());
    const order = ids(s);
    expect(order).toContain("review_summary");
    // Optional exploratory questions should not dominate the candidate list.
    expect(order).not.toContain("certifications_any");
  });
});

describe("planNextQuestion — end to end with mock provider", () => {
  it("returns a valid AdaptiveQuestion for an empty profile", async () => {
    const q = await planNextQuestion(state(), provider);
    expect(q.questionId).toBe("career_goal_target");
    expect(q.section).toBe("career_goal");
    expect(q.required).toBe(true);
    expect(q.nextAction).toBe("ask_question");
  });

  it("produces a skill_confirmation question carrying the pending suggestions", async () => {
    const s = state({
      careerGoal: "Vendedor",
      personalInformation: personalState({ firstName: "Ana", hasEmail: true }),
      education: [educationState({ institution: "Colegio", credential: "Secundaria" })],
      suggestedSkills: [skillState({ name: "Ventas", status: "suggested", evidence: "Vendía ropa" })],
    });
    const q = await planNextQuestion(s, provider);
    expect(q.inputType).toBe("skill_confirmation");
    expect(q.nextAction).toBe("confirm_skills");
    expect(q.suggestedSkills.map((x) => x.name)).toContain("Ventas");
  });
});
