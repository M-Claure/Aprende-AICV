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
  describeIncompleteEntries,
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
    expect(missingExperienceFields(experienceValues({ description: "   " }))).toEqual([
      "description",
    ]);
    // Whitespace in BOTH name fields leaves the entry nameless.
    expect(
      missingExperienceFields(experienceValues({ title: "   ", organization: "  " })),
    ).toEqual(["title", "organization"]);
  });

  it("takes a role OR an employer as the entry's name, never insisting on both", () => {
    /*
     * The funnel asks for neither, and plenty of real experience has no employer to
     * name — caring for a relative, selling at a market. Requiring both stranded
     * exactly this product's user on the last screen. See the note in
     * `lib/entry-required-fields.ts`.
     */
    expect(missingExperienceFields(experienceValues({ organization: "" }))).toEqual([]);
    expect(missingExperienceFields(experienceValues({ title: "" }))).toEqual([]);
    // Neither one: the entry has no name, which is the thing the rule exists for.
    expect(missingExperienceFields(experienceValues({ title: "", organization: "" }))).toEqual([
      "title",
      "organization",
    ]);
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

  it("reports the name pair when the entry has neither", () => {
    expect(missingEducationFields({ institution: "", credential: "" })).toEqual([
      "institution",
      "credential",
    ]);
  });

  it("takes the study OR the school as the name, never insisting on both", () => {
    /*
     * Both education questions render an "Omitir" button (`education_details`,
     * `education_dates`), so demanding their fields here punished a skip the funnel
     * itself offered — with the generate button disabled and no way back.
     */
    expect(missingEducationFields(educationValues({ institution: "" }))).toEqual([]);
    expect(missingEducationFields(educationValues({ credential: "" }))).toEqual([]);
  });

  it("never asks for a year the funnel lets you skip", () => {
    // `education_dates` is allowSkip: true and accepts "una fecha aproximada".
    expect(EDUCATION_FIELD_LABEL).not.toHaveProperty("endDate");
    expect(missingEducationFields(educationValues())).toEqual([]);
  });

  it("does NOT require an área de estudio", () => {
    /*
     * Deliberate: somebody whose highest level is primaria or secundaria has no
     * field of study, and the funnel never asks for one. Requiring it would leave
     * them unable to continue unless they invented something — a hard stop on
     * exactly the person this product is for. The box stays, the asterisk does not.
     */
    expect(missingEducationFields(educationValues())).toEqual([]);
    expect(EDUCATION_FIELD_LABEL).not.toHaveProperty("fieldOfStudy");
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

  it("treats an untouched entry as unnamed", () => {
    const v = educationRequiredValues({ institution: null, credential: null });
    expect(missingEducationFields(v)).toEqual(["institution", "credential"]);
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
      experience: [{ ...completeExperience, rawDescription: null, endDate: null }],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Cajera");
    expect(result[0]!.missing).toEqual([
      EXPERIENCE_FIELD_LABEL.endDate,
      EXPERIENCE_FIELD_LABEL.description,
    ]);
  });

  it("does not block an entry that has a role but no employer", () => {
    // The dead end this rule used to create for caregiving and street-market work.
    expect(
      incompleteEntries({
        education: [],
        experience: [{ ...completeExperience, organization: null }],
      }),
    ).toEqual([]);
  });

  it("asks for the name ONCE, as a choice, when an entry has neither", () => {
    const result = incompleteEntries({
      education: [],
      experience: [{ ...completeExperience, title: null, organization: null }],
    });
    // Not two lines: listing both would say two things are needed when one is.
    expect(result[0]!.missing).toEqual([
      `${EXPERIENCE_FIELD_LABEL.title} u ${EXPERIENCE_FIELD_LABEL.organization}`,
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
      education: [{ ...completeEducation, institution: null, credential: null }],
      experience: [{ ...completeExperience, title: null, organization: null }],
    });
    expect(result.map((r) => r.section)).toEqual(["education", "experience"]);
    expect(result[0]!.missing).toEqual([
      `${EDUCATION_FIELD_LABEL.credential} u ${EDUCATION_FIELD_LABEL.institution}`,
    ]);
  });

  it("does not block a study with no school and no year", () => {
    // The dead end this rule used to create for anyone who pressed "Omitir" twice.
    expect(
      incompleteEntries({
        education: [{ ...completeEducation, institution: null }],
        experience: [],
      }),
    ).toEqual([]);
  });
});

describe("describeIncompleteEntries — what POST /generate refuses with", () => {
  it("is null when nothing blocks, so the route stays out of the way", () => {
    expect(describeIncompleteEntries([])).toBeNull();
  });

  it("names each entry and what it still needs", () => {
    const msg = describeIncompleteEntries([
      { id: "x1", section: "experience", name: "Cajera", missing: ["Terminó en"] },
      { id: "e1", section: "education", name: "Secundaria", missing: ["Título / nivel u Institución"] },
    ]);
    expect(msg).toBe(
      "Antes de crear tu currículum, falta llenar: Cajera (Terminó en); " +
        "Secundaria (Título / nivel u Institución).",
    );
  });

  it("never leaks an id into a message the person reads", () => {
    // «Cuéntame más sobre «7f3c…»» is the failure this product already learned from,
    // and this string is shown to the user by the improvement round's error banner.
    const msg = describeIncompleteEntries([
      {
        id: "7f3c9c02-0000-4000-8000-000000000000",
        section: "experience",
        name: "Experiencia sin nombre",
        missing: ["Puesto / rol u Organización"],
      },
    ]);
    expect(msg).not.toContain("7f3c");
    expect(msg).toContain("Experiencia sin nombre");
  });
});
