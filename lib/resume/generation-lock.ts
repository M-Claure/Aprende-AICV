/**
 * De-duplicates concurrent résumé generations for one profile.
 *
 * Generation is the single most expensive call in the product, and nothing on the
 * server stopped it running twice: the UI guards with a `busy` flag, but a
 * double-click that lands before state updates, a client retry after a timeout, or
 * the same profile open in two tabs each start a second full generation — paying
 * twice and racing to write two résumé versions.
 *
 * So a second request for a profile already generating joins the first instead of
 * starting its own: one model call, one new version, both callers get the same
 * résumé. The lock lives with `generateResume` rather than in a route, so every
 * caller — generate, regenerate-section, anything added later — is covered without
 * having to remember it.
 *
 * In-process, which catches what actually happens (one person, one instance,
 * clicking twice). Two instances serving the same profile at the same moment would
 * still both generate; that needs a database lock and is not what this is for.
 */

const inFlight = new Map<string, Promise<unknown>>();

export async function withGenerationLock<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(profileId);
  if (existing) {
    console.log(`[resume] generación ya en curso para ${profileId}; reusando (sin segundo cobro).`);
    return existing as Promise<T>;
  }
  // Chained so the entry is cleared on failure too — a failed generation must not
  // wedge the profile into "already generating" forever.
  const started = run().finally(() => {
    inFlight.delete(profileId);
  });
  inFlight.set(profileId, started);
  return started;
}

/** Test seam. */
export function clearGenerationLocks(): void {
  inFlight.clear();
}
