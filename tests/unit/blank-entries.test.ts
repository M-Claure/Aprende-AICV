/**
 * A blank entry never counts as a background, and never reaches a résumé.
 *
 * `hasMeaningfulBackground` used to count entries by array LENGTH, so an entry
 * with nothing in it — the experience counter opens one per experience counted,
 * and the Review screen's "+ Agregar" opens one directly — satisfied readiness on
 * its own. It then reached the improvement loop, which had no name to refer to it
 * by and asked about it by id. Reported from a real run.
 */
import { describe, expect, it } from "vitest";
import { computeCompleteness } from "@/lib/question-engine/completeness-engine";
import { isEducationBlank, isExperienceBlank, isProjectBlank } from "@/lib/entry-blankness";
import {
  completenessInput,
  educationState,
  experienceState,
  personalState,
  projectState,
  readyProfile,
  skillState,
} from "../helpers/factories";

describe("blankness predicates", () => {
  it("recognises a completely empty entry", () => {
    expect(isExperienceBlank(experienceState())).toBe(true);
    expect(isEducationBlank(educationState())).toBe(true);
    expect(isProjectBlank(projectState({ name: "" }))).toBe(true);
  });

  it("treats any typed content as filled — thin is not blank", () => {
    expect(isExperienceBlank(experienceState({ title: "Cajera" }))).toBe(false);
    expect(isExperienceBlank(experienceState({ organization: "Tienda" }))).toBe(false);
    expect(isExperienceBlank(experienceState({ rawDescription: "Atendía clientes" }))).toBe(false);
    expect(isExperienceBlank(experienceState({ responsibilities: ["Cobraba"] }))).toBe(false);
    expect(isEducationBlank(educationState({ credential: "Secundaria" }))).toBe(false);
    expect(isEducationBlank(educationState({ institution: "Colegio" }))).toBe(false);
  });

  it("does not count whitespace as content", () => {
    expect(isExperienceBlank(experienceState({ title: "   " }))).toBe(true);
    expect(isEducationBlank(educationState({ credential: "  " }))).toBe(true);
  });
});

describe("completeness — a blank entry is not a background", () => {
  const withSkillAndIdentity = (o: Parameters<typeof completenessInput>[0] = {}) =>
    completenessInput({
      careerGoal: "Vendedora",
      targetRole: "Vendedora",
      personalInformation: personalState({ firstName: "María", hasEmail: true }),
      confirmedSkills: [skillState({ name: "Atención al cliente", status: "confirmed" })],
      ...o,
    });

  it("a profile whose only experience is blank is not ready", () => {
    const r = computeCompleteness(withSkillAndIdentity({ experience: [experienceState()] }));
    expect(r.readyToGenerate).toBe(false);
    expect(r.missingCriticalFields.map((m) => m.field)).toContain("background");
  });

  it("asks for the blank card to be filled in or deleted", () => {
    const r = computeCompleteness(withSkillAndIdentity({ experience: [experienceState()] }));
    const blank = r.missingCriticalFields.find((m) => m.field === "blankEntries");
    expect(blank?.label).toBe("Llena o borra la tarjeta que quedó vacía");
  });

  it("counts blank cards across sections, and pluralizes", () => {
    const r = computeCompleteness(
      withSkillAndIdentity({
        experience: [experienceState({ title: "Cajera" }), experienceState()],
        education: [educationState()],
      }),
    );
    const blank = r.missingCriticalFields.find((m) => m.field === "blankEntries");
    expect(blank?.label).toBe("Llena o borra las 2 tarjetas que quedaron vacías");
    // The filled experience is a real background, so only the blank cards block.
    expect(r.missingCriticalFields.map((m) => m.field)).not.toContain("background");
    expect(r.readyToGenerate).toBe(false);
  });

  it("becomes ready once the blank card is filled in", () => {
    const r = computeCompleteness(
      withSkillAndIdentity({ experience: [experienceState({ rawDescription: "Atendía clientes" })] }),
    );
    expect(r.readyToGenerate).toBe(true);
    expect(r.missingCriticalFields).toHaveLength(0);
  });

  it("becomes ready once the blank card is deleted", () => {
    const r = computeCompleteness(
      withSkillAndIdentity({
        experience: [experienceState({ title: "Cajera", responsibilities: ["Cobraba"] })],
      }),
    );
    expect(r.readyToGenerate).toBe(true);
  });

  it("leaves an already-complete profile ready", () => {
    expect(computeCompleteness(readyProfile()).readyToGenerate).toBe(true);
  });
});
