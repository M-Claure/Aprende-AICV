/**
 * Which résumé a returning visitor is offered — "continue where I left off".
 *
 * Why this exists at all: the session cookie is the only handle on a résumé (see
 * `lib/auth.ts`), and the landing page used to ignore it. A visitor who closed the
 * tab mid-funnel and came back pressed the same CTA, created a SECOND profile, and
 * their half-finished one became unreachable — nothing in the UI ever named it
 * again. The funnel is long and the audience is mostly on phones, so that is a
 * regular event, not an edge case.
 *
 * The rule is deliberately "the one you touched last", not "the one that is
 * unfinished":
 *
 *  - A finalized résumé is the MOST valuable thing to hand back, not the least —
 *    it is the finished document the person came for, and the workspace is where
 *    they download it. Skipping it would orphan exactly what they wanted.
 *  - Someone who genuinely wants a second résumé can still start one; this only
 *    decides what gets offered first.
 *
 * `archived` is the one status excluded: it means deliberately shelved, so
 * resurfacing it would contradict the act of archiving. (Nothing sets it today —
 * the state exists in `ResumeStatus` and the rule should not have to be found and
 * fixed later by whoever starts using it.)
 *
 * Pure module: imports only types, so it can be unit-tested with plain objects and
 * called from either side of the wire.
 */
import type { ResumeProfile } from "@/types";

/** The only fields the choice depends on. */
type Resumable = Pick<ResumeProfile, "id" | "status" | "createdAt" | "updatedAt">;

/**
 * The profile to offer, or `null` when there is nothing to continue.
 *
 * Generic so callers keep their own row type: the API route hands back the whole
 * `ResumeProfile` it selected, not a narrowed copy.
 */
export function pickResumableProfile<T extends Resumable>(profiles: readonly T[]): T | null {
  const open = profiles.filter((p) => p.status !== "archived");
  if (open.length === 0) return null;
  // Reduce rather than sort: one pass, no copy, and `compare` stays the single
  // definition of "more recent" for both the pick and its tests.
  return open.reduce((best, p) => (compare(p, best) > 0 ? p : best));
}

/**
 * Newest-first ordering. Positive when `a` should win.
 *
 * Timestamps are PARSED rather than string-compared: the two stores do not agree
 * on format (`MemoryStore` writes `toISOString()`'s trailing `Z`, Postgres returns
 * `+00:00`), and lexicographic order across those two spellings is wrong. An
 * unparseable value sorts oldest instead of throwing — a résumé with a strange
 * timestamp should lose the tie, not break the landing page.
 *
 * `createdAt` then `id` break exact ties so the answer is stable across calls; two
 * profiles really can share an `updatedAt` when a single request writes both.
 */
function compare(a: Resumable, b: Resumable): number {
  const byUpdated = order(time(a.updatedAt), time(b.updatedAt));
  if (byUpdated !== 0) return byUpdated;
  const byCreated = order(time(a.createdAt), time(b.createdAt));
  if (byCreated !== 0) return byCreated;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Sign of `a - b`, via comparison rather than subtraction: two unparseable dates
 * are both `-Infinity`, and subtracting those gives `NaN`, which would silently
 * skip the tie-breaks below instead of falling through to them.
 */
function order(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function time(value: string): number {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}
