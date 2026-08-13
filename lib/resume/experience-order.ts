/**
 * Deterministic reverse-chronological ordering of experience entries (newest
 * first) — the order every résumé reader expects.
 *
 * PURE: no I/O, no LLM. The model is never asked to sort; it receives the
 * entries already ordered and returns blocks we re-map onto this same order, so
 * ordering cannot drift between generations.
 *
 * Dates in this product are deliberately FREE TEXT: the funnel asks for "una
 * fecha aproximada" and preserves whatever the person said ("marzo 2020",
 * "2019", "de junio 2021 a la actualidad"). So ordering parses what it can and
 * degrades gracefully — an entry we cannot date keeps its capture position, at
 * the end, rather than being guessed at.
 */

import { MONTHS_ES } from "@/lib/experience-dates";

/** The only fields ordering looks at. */
export interface DatedExperience {
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
}

/**
 * Month-name lookup: the canonical names come from `lib/experience-dates.ts`, the
 * same list the Review screen's dropdown renders, so a date picked there always
 * parses here. The extras are abbreviations and variants people actually type in
 * the funnel, which the dropdown never produces.
 */
const MONTH_VARIANTS: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, sept: 9, set: 9, setiembre: 9,
  oct: 10, nov: 11, dic: 12,
};
const MONTHS: Record<string, number> = {
  ...Object.fromEntries(MONTHS_ES.map((name, i) => [name, i + 1])),
  ...MONTH_VARIANTS,
};

/** "Still going on" wording, in the words the funnel actually receives. */
const PRESENT_MARKER =
  /\b(actualidad|actualmente|actual|presente|hoy|ahora|vigente|en\s+curso|sigo|todav[ií]a)\b/i;

/** A year we are willing to believe is a date (not "20 clientes", not a phone). */
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

/** An ongoing entry outranks every dated one. */
const CURRENT_SCORE = Number.MAX_SAFE_INTEGER;

/**
 * Month used when a year carries no month ("2019"). Mid-year is the least-wrong
 * neutral: it keeps a bare year from sorting either above December or below
 * January of the same year, and only ever matters as a same-year tiebreak.
 */
const NEUTRAL_MONTH = 6;

/** Comparable recency of one year/month pair. */
function score(year: number, month: number): number {
  return year * 12 + month;
}

/**
 * The most recent year/month pair mentioned anywhere in a free-text date, or
 * null. Taking the MAX matters because one field often holds a whole range —
 * the funnel's date answer is stored on `startDate` verbatim, so "de 2019 a
 * 2021" must rank as 2021, not 2019.
 */
export function latestMomentIn(text: string | null | undefined): number | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  let best: number | null = null;
  /** Character positions of years we already read a month for. */
  const qualified = new Set<number>();

  const consider = (year: number, month: number) => {
    // NaN fails every comparison, so it is rejected explicitly rather than by range.
    if (!Number.isFinite(year) || !Number.isFinite(month)) return;
    if (year < MIN_YEAR || year > MAX_YEAR) return;
    if (month < 1 || month > 12) return;
    const s = score(year, month);
    if (best === null || s > best) best = s;
  };

  // "junio de 2019", "junio 2019", "jun. 2019"
  for (const m of lower.matchAll(/([a-záéíóúñ]+)\.?\s+(?:de\s+)?(\d{4})/g)) {
    const month = MONTHS[m[1]!];
    if (month === undefined) continue;
    qualified.add(m.index + m[0].lastIndexOf(m[2]!));
    consider(Number(m[2]), month);
  }
  // "2019 junio" (rarer, but cheap to accept)
  for (const m of lower.matchAll(/(\d{4})\s+(?:de\s+)?([a-záéíóúñ]+)/g)) {
    const month = MONTHS[m[2]!];
    if (month === undefined) continue;
    qualified.add(m.index);
    consider(Number(m[1]), month);
  }
  // "06/2019", "6-2019"
  for (const m of lower.matchAll(/\b(\d{1,2})[/\-.](\d{4})\b/g)) {
    qualified.add(m.index + m[0].lastIndexOf(m[2]!));
    consider(Number(m[2]), Number(m[1]));
  }
  // "2019-06", "2019/6"
  for (const m of lower.matchAll(/\b(\d{4})[/\-.](\d{1,2})\b/g)) {
    qualified.add(m.index);
    consider(Number(m[1]), Number(m[2]));
  }
  // Bare years, LAST: only years no pass above read a month for. Skipping the
  // qualified ones matters because this pass scores at NEUTRAL_MONTH, which would
  // otherwise outrank (and erase) every real month before June.
  for (const m of lower.matchAll(/\b(\d{4})\b/g)) {
    if (qualified.has(m.index)) continue;
    consider(Number(m[1]), NEUTRAL_MONTH);
  }

  return best;
}

/**
 * How recent an entry is: higher = more recent, null = undateable.
 *
 * `endDate` wins over `startDate` because recency is about when the experience
 * ENDED. An entry flagged current — or whose free-text dates say it still goes
 * on — outranks everything dated.
 */
export function experienceRecency(entry: DatedExperience): number | null {
  if (entry.isCurrent) return CURRENT_SCORE;
  if (PRESENT_MARKER.test(entry.endDate ?? "") || PRESENT_MARKER.test(entry.startDate ?? "")) {
    return CURRENT_SCORE;
  }
  return latestMomentIn(entry.endDate) ?? latestMomentIn(entry.startDate);
}

/**
 * Orders entries newest-first. Undated entries go last, keeping the order the
 * person captured them in; equal dates likewise fall back to capture order, so
 * the result is stable across generations of the same profile.
 */
export function sortExperienceNewestFirst<T extends DatedExperience>(entries: readonly T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index, recency: experienceRecency(entry) }))
    .sort((a, b) => {
      if (a.recency === null || b.recency === null) {
        if (a.recency === b.recency) return a.index - b.index; // both undated
        return a.recency === null ? 1 : -1; // undated sinks
      }
      if (a.recency !== b.recency) return b.recency - a.recency;
      return a.index - b.index;
    })
    .map((x) => x.entry);
}
