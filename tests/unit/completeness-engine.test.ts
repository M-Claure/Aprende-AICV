import { describe, expect, it } from "vitest";
import { computeCompleteness } from "@/lib/question-engine/completeness-engine";
import {
  completenessInput,
  educationState,
  experienceState,
  personalState,
  projectState,
  readyProfile,
  skillState,
} from "../helpers/factories";

describe("computeCompleteness — critical requirements", () => {
  it("an empty profile is insufficient and not ready to generate", () => {
    const r = computeCompleteness(completenessInput());
    expect(r.readyToGenerate).toBe(false);
    expect(r.readiness).toBe("insufficient_information");
    expect(r.overallScore).toBe(0);
    const missing = r.missingCriticalFields.map((m) => m.field);
    expect(missing).toEqual(
      expect.arrayContaining(["objective", "firstName", "contact", "background", "confirmedSkill"]),
    );
  });

  it("a fully populated profile is ready to generate", () => {
    const r = computeCompleteness(readyProfile());
    expect(r.readyToGenerate).toBe(true);
    expect(["ready", "ready_but_improvable"]).toContain(r.readiness);
    expect(r.missingCriticalFields).toHaveLength(0);
    expect(r.overallScore).toBeGreaterThan(60);
  });

  it("recommends the review section once ready", () => {
    const r = computeCompleteness(readyProfile({ languages: [] }));
    // Ready but improvable (languages missing) still recommends review or a weak section.
    expect(r.readyToGenerate).toBe(true);
  });
});

describe("computeCompleteness — no formal employment still counts", () => {
  it("a profile with only caregiving experience has meaningful background", () => {
    const r = computeCompleteness(
      completenessInput({
        careerGoal: "Cuidadora",
        personalInformation: personalState({ firstName: "Ana", hasPhone: true }),
        experience: [
          experienceState({
            experienceType: "caregiving",
            responsibilities: ["Cuidaba a un familiar", "Administraba medicamentos"],
          }),
        ],
        confirmedSkills: [skillState({ name: "Organización", status: "confirmed" })],
      }),
    );
    expect(r.readyToGenerate).toBe(true);
    expect(r.readiness).not.toBe("insufficient_information");
    expect(r.missingCriticalFields.map((m) => m.field)).not.toContain("background");
  });

  it("a project-only user (no education, no employment) has meaningful background", () => {
    const r = computeCompleteness(
      completenessInput({
        careerGoal: "Desarrollador",
        personalInformation: personalState({ firstName: "Luis", hasEmail: true }),
        projects: [projectState({ name: "App de recetas" })],
        confirmedSkills: [skillState({ name: "Programación", status: "confirmed" })],
      }),
    );
    expect(r.missingCriticalFields.map((m) => m.field)).not.toContain("background");
    expect(r.readyToGenerate).toBe(true);
  });
});

describe("computeCompleteness — readiness gradations", () => {
  it("has background but missing confirmed skill => partially_ready", () => {
    const r = computeCompleteness(
      completenessInput({
        careerGoal: "Vendedor",
        personalInformation: personalState({ firstName: "Jose", hasEmail: true }),
        education: [educationState({ institution: "Colegio", credential: "Secundaria" })],
        // no confirmed skills
      }),
    );
    expect(r.readiness).toBe("partially_ready");
    expect(r.readyToGenerate).toBe(false);
    expect(r.missingCriticalFields.map((m) => m.field)).toContain("confirmedSkill");
  });

  it("does not block generation on optional/helpful fields only", () => {
    const r = computeCompleteness(readyProfile());
    // Missing helpful fields must not flip readyToGenerate to false.
    expect(r.readyToGenerate).toBe(true);
    expect(r.missingCriticalFields).toHaveLength(0);
  });
});

describe("computeCompleteness — recommended section ladder", () => {
  it("recommends career_goal first when nothing exists", () => {
    expect(computeCompleteness(completenessInput()).recommendedSection).toBe("career_goal");
  });

  it("recommends personal_information after objective is set", () => {
    const r = computeCompleteness(completenessInput({ careerGoal: "Diseñadora" }));
    expect(r.recommendedSection).toBe("personal_information");
  });

  it("recommends education before experience for a low-experience user", () => {
    const r = computeCompleteness(
      completenessInput({
        careerGoal: "Diseñadora",
        personalInformation: personalState({ firstName: "Rosa", hasEmail: true }),
      }),
    );
    expect(r.recommendedSection).toBe("education");
  });

  it("recommends skills when evidence exists but no skill is confirmed", () => {
    const r = computeCompleteness(
      completenessInput({
        careerGoal: "Diseñadora",
        personalInformation: personalState({ firstName: "Rosa", hasEmail: true }),
        education: [educationState({ institution: "Instituto", credential: "Técnico" })],
        experience: [experienceState({ responsibilities: ["Diseñaba folletos"] })],
      }),
    );
    expect(r.recommendedSection).toBe("skills");
  });
});

describe("computeCompleteness — section breakdown", () => {
  it("marks certifications and projects as optional when empty", () => {
    const r = computeCompleteness(completenessInput());
    const byName = Object.fromEntries(r.sections.map((s) => [s.section, s.status]));
    expect(byName.certifications).toBe("optional");
    expect(byName.projects).toBe("optional");
  });

  it("marks completed sections as complete", () => {
    const r = computeCompleteness(readyProfile());
    expect(r.completedSections).toContain("career_goal");
    expect(r.completedSections).toContain("personal_information");
  });
});
