/**
 * The Review screen writes experience dates through month + year dropdowns. Those
 * values are stored as free text, so the contract that matters is: whatever the
 * dropdowns produce, the résumé's chronological sort must be able to read it.
 * These tests pin the two modules together in both directions.
 */
import { describe, expect, it } from "vitest";
import {
  MONTHS_ES,
  MONTH_OPTIONS,
  formatExperienceDate,
  parseExperienceDate,
  yearOptions,
} from "@/lib/experience-dates";
import { experienceRecency, latestMomentIn, sortExperienceNewestFirst } from "@/lib/resume/experience-order";

describe("formatting what the dropdowns produce", () => {
  it("builds 'mes año' when both are picked", () => {
    expect(formatExperienceDate("3", "2020")).toBe("marzo 2020");
    expect(formatExperienceDate("12", "1999")).toBe("diciembre 1999");
  });

  it("falls back to the bare year when no month is picked", () => {
    expect(formatExperienceDate("", "2019")).toBe("2019");
  });

  it("yields nothing without a year — a month alone cannot be ordered", () => {
    expect(formatExperienceDate("6", "")).toBe("");
    expect(formatExperienceDate("", "")).toBe("");
  });
});

describe("reading a stored date back into the dropdowns", () => {
  it("round-trips its own output for every month", () => {
    for (const [i] of MONTHS_ES.entries()) {
      const month = String(i + 1);
      const stored = formatExperienceDate(month, "2021");
      expect(parseExperienceDate(stored)).toEqual({ month, year: "2021" });
    }
  });

  it("reads free text a person typed in the funnel", () => {
    // The funnel stores the whole answer verbatim, so Review must cope with ranges.
    expect(parseExperienceDate("de marzo 2020 a la actualidad")).toEqual({ month: "3", year: "2020" });
    expect(parseExperienceDate("2019")).toEqual({ month: "", year: "2019" });
    expect(parseExperienceDate("junio de 2018")).toEqual({ month: "6", year: "2018" });
  });

  it("comes back empty rather than guessing", () => {
    expect(parseExperienceDate("hace unos años")).toEqual({ month: "", year: "" });
    expect(parseExperienceDate(null)).toEqual({ month: "", year: "" });
    expect(parseExperienceDate("")).toEqual({ month: "", year: "" });
  });

  it("ignores a number that is not a plausible year", () => {
    expect(parseExperienceDate("como 20 clientes")).toEqual({ month: "", year: "" });
  });
});

describe("dropdown options", () => {
  it("offers twelve capitalized months, January first", () => {
    expect(MONTH_OPTIONS).toHaveLength(12);
    expect(MONTH_OPTIONS[0]).toEqual({ value: "1", label: "Enero" });
    expect(MONTH_OPTIONS[11]).toEqual({ value: "12", label: "Diciembre" });
  });

  it("lists years newest first, reaching back a working life", () => {
    const years = yearOptions(2026);
    expect(years[0]).toBe("2026");
    expect(years).toContain("1966");
    expect(years.length).toBe(61);
  });
});

describe("a date picked in Review orders the résumé correctly", () => {
  it("every month the dropdown offers is understood by the sort", () => {
    for (const [i] of MONTHS_ES.entries()) {
      const stored = formatExperienceDate(String(i + 1), "2020");
      expect(latestMomentIn(stored), `month ${i + 1} must parse`).not.toBeNull();
    }
  });

  it("orders months within the same year, in dropdown order", () => {
    const moments = MONTHS_ES.map((_, i) => latestMomentIn(formatExperienceDate(String(i + 1), "2020"))!);
    const ascending = [...moments].sort((a, b) => a - b);
    expect(moments).toEqual(ascending);
    expect(new Set(moments).size).toBe(12); // no two months collapse together
  });

  it("sorts entries built from the dropdowns newest first", () => {
    const entry = (label: string, sm: string, sy: string, em: string, ey: string, isCurrent = false) => ({
      label,
      startDate: formatExperienceDate(sm, sy),
      endDate: isCurrent ? "" : formatExperienceDate(em, ey),
      isCurrent,
    });
    const list = [
      entry("vieja", "1", "2014", "6", "2016"),
      entry("actual", "3", "2024", "", "", true),
      entry("media", "9", "2019", "11", "2021"),
    ];
    expect(sortExperienceNewestFirst(list).map((e) => e.label)).toEqual(["actual", "media", "vieja"]);
  });

  it("treats the 'sigo aquí' shape as ongoing", () => {
    // Checking the box clears the end date and sets isCurrent.
    const ongoing = { startDate: formatExperienceDate("5", "2022"), endDate: "", isCurrent: true };
    const finished = { startDate: formatExperienceDate("5", "2025"), endDate: formatExperienceDate("1", "2026"), isCurrent: false };
    expect(experienceRecency(ongoing)!).toBeGreaterThan(experienceRecency(finished)!);
  });

  it("a year-only date still places the entry", () => {
    const yearOnly = { startDate: formatExperienceDate("", "2015"), endDate: "", isCurrent: false };
    expect(experienceRecency(yearOnly)).not.toBeNull();
  });
});
