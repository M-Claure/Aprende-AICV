import { describe, expect, it } from "vitest";
import {
  experienceRecency,
  latestMomentIn,
  sortExperienceNewestFirst,
} from "@/lib/resume/experience-order";

/** Minimal dated entry with a label so assertions read as an order. */
function e(label: string, startDate: string | null, endDate: string | null, isCurrent = false) {
  return { label, startDate, endDate, isCurrent };
}
const order = (entries: ReturnType<typeof e>[]) => sortExperienceNewestFirst(entries).map((x) => x.label);

describe("latestMomentIn — free-text Spanish dates", () => {
  it("reads bare years, Spanish months and numeric formats", () => {
    expect(latestMomentIn("2019")).not.toBeNull();
    expect(latestMomentIn("junio de 2019")).toBeGreaterThan(latestMomentIn("marzo de 2019")!);
    expect(latestMomentIn("06/2019")).toBe(latestMomentIn("junio de 2019"));
    expect(latestMomentIn("2019-06")).toBe(latestMomentIn("junio de 2019"));
    expect(latestMomentIn("2021")).toBeGreaterThan(latestMomentIn("diciembre de 2020")!);
  });

  it("takes the most recent date when one field holds a whole range", () => {
    // The funnel stores the date answer verbatim, so a range lands in one field.
    expect(latestMomentIn("de 2019 a 2021")).toBe(latestMomentIn("2021"));
    expect(latestMomentIn("de marzo 2020 a agosto 2022")).toBe(latestMomentIn("agosto 2022"));
  });

  it("ignores numbers that are not years", () => {
    expect(latestMomentIn("como 20 clientes por día")).toBeNull();
    expect(latestMomentIn("")).toBeNull();
    expect(latestMomentIn(null)).toBeNull();
  });
});

describe("experienceRecency", () => {
  it("ranks an ongoing experience above every dated one", () => {
    const current = experienceRecency(e("a", "2015", null, true))!;
    expect(current).toBeGreaterThan(experienceRecency(e("b", "2023", "2024"))!);
  });

  it("treats 'a la actualidad' wording as ongoing", () => {
    // What the funnel actually captures: the whole answer on startDate.
    const recency = experienceRecency(e("a", "de marzo 2020 a la actualidad", null))!;
    expect(recency).toBe(experienceRecency(e("b", "2020", null, true))!);
  });

  it("prefers the end date over the start date", () => {
    expect(experienceRecency(e("a", "2010", "2022"))).toBe(latestMomentIn("2022"));
  });

  it("returns null when nothing can be dated", () => {
    expect(experienceRecency(e("a", null, null))).toBeNull();
    expect(experienceRecency(e("a", "hace tiempo", ""))).toBeNull();
  });
});

describe("sortExperienceNewestFirst", () => {
  it("orders newest first with ongoing roles at the top", () => {
    const list = [
      e("vieja", "2012", "2014"),
      e("actual", "2023", null, true),
      e("media", "2018", "2021"),
    ];
    expect(order(list)).toEqual(["actual", "media", "vieja"]);
  });

  it("sorts undated entries last, keeping the order they were captured in", () => {
    const list = [
      e("sin-fecha-1", null, null),
      e("con-fecha", "2020", "2022"),
      e("sin-fecha-2", null, null),
    ];
    expect(order(list)).toEqual(["con-fecha", "sin-fecha-1", "sin-fecha-2"]);
  });

  it("is stable for equal dates, so the order does not drift between generations", () => {
    const list = [e("a", "2020", "2021"), e("b", "2020", "2021"), e("c", "2020", "2021")];
    expect(order(list)).toEqual(["a", "b", "c"]);
    expect(order(sortExperienceNewestFirst(list))).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input", () => {
    const list = [e("vieja", "2012", "2014"), e("nueva", "2022", "2023")];
    sortExperienceNewestFirst(list);
    expect(list.map((x) => x.label)).toEqual(["vieja", "nueva"]);
  });

  it("uses month precision within the same year", () => {
    const list = [e("mar", "2020", "marzo de 2020"), e("nov", "2020", "noviembre de 2020")];
    expect(order(list)).toEqual(["nov", "mar"]);
  });
});
