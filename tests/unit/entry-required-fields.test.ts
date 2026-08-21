/**
 * The required-field rule that gates continuing, not just saving a card.
 *
 * The bug this pins: the red asterisks blocked each card's "Guardar" and nothing
 * else, so someone could leave a card half-empty, never press Guardar, and press
 * "Generar mi currículum" anyway. The asterisks announced a rule that was not
 * enforced where it mattered.
 *
 * The rule now has one home and two readers — the card (form state) and the review
 * screen (persisted entries) — so those two cannot disagree about whether an entry
 * is finished.
 */
import { describe, expect, it } from "vitest";
import {
  EDUCATION_FIELD_LABEL,
  EXPERIENCE_FIELD_LABEL,
  educationRequiredValues,
  experienceRequiredValues,
  incompleteEntries,
  missingEducationFields,
  missingExperienceFields,
} from "@/lib/entry-required-fields";

const experienceValues = (over = {}) => ({
  title: "Cajera",
  organization: "Tienda La Esperanza",
  startYear: "2019",
  endYear: "2021",
  isCurrent: false,
  description: "Atendía a los clientes y cobraba en la caja.",
  ...over,
});

const educationValues = (over = {}) => ({
  institution: "Colegio Benito Juárez",
  credential: "Secundaria",
  fieldOfStudy: "General",
  endDate: "2018",
  ...over,
});

describe("missingExperienceFields", () => {
  it("reports nothing when every field is filled", () => {
    expect(missingExperienceFields(experienceValues())).toEqual([]);
  });

  it("reports each empty field, in the order the card shows them", () => {
    expect(
      missingExperienceFields({
        title: "",
        organization: "",
        startYear: "",
        endYear: "",
        isCurrent: false,
        description: "",
      }),
    ).toEqual(["title", "organization", "startDate", "endDate", "description"]);
  });

  it("does not count whitespace as filled", () => {
    expect(missingExperienceFields(experienceValues({ title: "   " }))).toEqual(["title"]);
  });

  it("stops asking for an end date when the person still works there", () => {
    // The checkbox IS the answer, and checking it clears the dropdowns — asking
    // anyway would be unanswerable.
    expect(missingExperienceFields(experienceValues({ isCurrent: true, endYear: "" }))).toEqual([]);
  });

  it("needs only the YEAR of a date, never the month", () => {
    // Plenty of people remember the year but not the month, and a bare year still
    // orders the résumé correctly.
    expect(missingExperienceFields(experienceValues({ startYear: "2019" }))).toEqual([]);
  });
});

describe("missingEducationFields", () => {
  it("reports nothing when every field is filled", () => {
    expect(missingEducationFields(educationValues())).toEqual([]);
  });

  it("reports each empty field", () => {
    expect(
      missingEducationFields({ institution: "", credential: "", fieldOfStudy: "", endDate: "" }),
    ).toEqual(["institution", "credential", "fieldOfStudy", "endDate"]);
  });
});

describe("reading a persisted entry", () => {
  it("takes the year out of the free-text date the funnel stored", () => {
    // Dates are stored as the person said them ("marzo 2020"), not as a format.
    const v = experienceRequiredValues({
      title: "Cajera",
      organization: "Tienda",
      startDate: "marzo 2020",
      endDate: "de junio 2021",
      isCurrent: false,
      rawDescription: "Cobraba",
      responsibilities: [],
    });
    expect(v.startYear).toBe("2020");
    expect(v.endYear).toBe("2021");
    expect(missingExperienceFields(v)).toEqual([]);
  });

  it("counts a date with no year at all as missing", () => {
    const v = experienceRequiredValues({
      title: "Cajera",
      organization: "Tienda",
      startDate: "hace unos años",
      endDate: "2021",
      isCurrent: false,
      rawDescription: "Cobraba",
      responsibilities: [],
    });
    expect(missingExperienceFields(v)).toEqual(["startDate"]);
  });

  it("accepts responsibilities as having said what the person did", () => {
    // An entry captured as a list has answered "¿qué hacías?" — and this is exactly
    // the fallback the card uses to fill that box, so the two must agree.
    const v = experienceRequiredValues({
      title: "Cajera",
      organization: "Tienda",
      startDate: "2019",
      endDate: "2021",
      isCurrent: false,
      rawDescription: null,
      responsibilities: ["Cobraba en la caja", "Atendía clientes"],
    });
    expect(missingExperienceFields(v)).toEqual([]);
  });

  it("treats every null on an untouched entry as missing", () => {
    const v = educationRequiredValues({
      institution: null,
      credential: null,
      fieldOfStudy: null,
      endDate: null,
    });
    expect(missingEducationFields(v)).toHaveLength(4);
  });
});

describe("incompleteEntries — what blocks continuing", () => {
  const completeExperience = {
    id: "x1",
    title: "Cajera",
    organization: "Tienda",
    startDate: "2019",
    endDate: "2021",
    isCurrent: false,
    rawDescription: "Cobraba",
    responsibilities: [],
  };
  const completeEducation = {
    id: "e1",
    institution: "Colegio",
    credential: "Secundaria",
    fieldOfStudy: "General",
    endDate: "2018",
  };

  it("is empty when everything is filled — the button must not be stuck", () => {
    expect(
      incompleteEntries({ education: [completeEducation], experience: [completeExperience] }),
    ).toEqual([]);
  });

  it("is empty for a profile with no entries at all", () => {
    // Readiness is the completeness engine's job; this rule only judges entries
    // that exist, so it must not invent a reason to block.
    expect(incompleteEntries({ education: [], experience: [] })).toEqual([]);
  });

  it("names the entry and its missing fields in Spanish", () => {
    const result = incompleteEntries({
      education: [],
      experience: [{ ...completeExperience, organization: null, endDate: null }],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Cajera");
    expect(result[0]!.missing).toEqual([
      EXPERIENCE_FIELD_LABEL.organization,
      EXPERIENCE_FIELD_LABEL.endDate,
    ]);
  });

  it("never identifies an entry by its id", () => {
    // «Cuéntame más sobre «7f3c…»» is the failure the funnel already learned from.
    const result = incompleteEntries({
      education: [],
      experience: [{ ...completeExperience, id: "7f3c-uuid", title: null, organization: null }],
    });
    expect(result[0]!.name).toBe("Experiencia sin nombre");
    expect(result[0]!.name).not.toContain("7f3c");
  });

  it("falls back to the organization when there is no job title", () => {
    const result = incompleteEntries({
      education: [],
      experience: [{ ...completeExperience, title: null, endDate: null }],
    });
    expect(result[0]!.name).toBe("Tienda");
  });

  it("reports education and experience together, education first", () => {
    const result = incompleteEntries({
      education: [{ ...completeEducation, fieldOfStudy: null }],
      experience: [{ ...completeExperience, title: null }],
    });
    expect(result.map((r) => r.section)).toEqual(["education", "experience"]);
    expect(result[0]!.missing).toEqual([EDUCATION_FIELD_LABEL.fieldOfStudy]);
  });
});
