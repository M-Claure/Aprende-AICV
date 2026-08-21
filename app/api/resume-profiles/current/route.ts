import { handleRoute, ok } from "@/lib/http";
import { resolveExistingUserId } from "@/lib/auth";
import { getStore } from "@/lib/repositories";
import { pickResumableProfile } from "@/lib/resumable-profile";

export const dynamic = "force-dynamic";

/**
 * GET /api/resume-profiles/current — the résumé this visitor already has, if any.
 *
 * Answers the landing page's "have you been here before?" so a returning visitor is
 * offered their own work instead of silently starting a second résumé (see
 * `lib/resumable-profile.ts`).
 *
 * Two things make this route different from every other one:
 *
 *  1. It does NOT use `getRequestContext`, because that mints a guest session. This
 *     is called on every landing pageview, so minting here would create an
 *     `auth.users` row for every anonymous visitor — before consent, and before we
 *     have any way to reach them. `resolveExistingUserId` reads the session without
 *     creating one, and a visitor with no session costs zero database queries.
 *  2. "No session" is a normal answer, not a 401. There is no login to send anyone
 *     to, so the honest reply is `{ profile: null }` — nothing to continue.
 *
 * The static `current` segment takes precedence over the sibling `[id]` route, so
 * this shadows a profile whose id is literally "current"; ids are UUIDs, so none is.
 */
export async function GET() {
  return handleRoute(async () => {
    const userId = await resolveExistingUserId();
    if (!userId) return ok({ profile: null });

    const profiles = await getStore().listResumeProfilesByUser(userId);
    return ok({ profile: pickResumableProfile(profiles) });
  });
}
