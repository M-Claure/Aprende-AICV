import { created, handleRoute, ok, readJson } from "@/lib/http";
import { getRequestContext } from "@/lib/request-context";
import { clientIp } from "@/lib/rate-limit";
import { enforceRateLimit } from "@/lib/services/usage-guard";
import { assembleProfileState } from "@/lib/profile-state";
import { CreateProfileBody } from "@/lib/validation/api-schemas";
import { parseFullName } from "@/lib/personal-contact";
import { TERMS_VERSION } from "@/lib/legal/terms";

export const dynamic = "force-dynamic";

/** POST /api/resume-profiles — start a new resume profile. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    /*
     * Counted by IP, BEFORE `getRequestContext` — this is the one route that runs
     * before an identity exists, and calling it is what creates one. Limiting by
     * user here would be meaningless: each request would be its own brand-new user
     * with a fresh quota, which is exactly how a script would mint guest accounts
     * in bulk.
     *
     * The allowance is deliberately high (60/hour) because this audience shares
     * connections — a computer lab, a cyber café, a family behind one address. A
     * forged `x-forwarded-for` defeats it, which is why the per-user limits and the
     * spend caps, not this line, are what actually bound cost.
     */
    await enforceRateLimit("profile_create", { ip: clientIp(request.headers) });

    const { userId, store, analytics } = await getRequestContext();
    // Zod guarantees `acceptTerms === true` plus a name and at least one valid
    // contact channel; anything missing 422s before we reach here, so nothing is
    // written to the database without recorded consent and a way to reach the
    // person. Email and phone arrive as separate, individually validated fields —
    // there is nothing to extract, so a blank one is simply absent.
    const body = CreateProfileBody.parse(await readJson(request));
    const name = parseFullName(body.fullName);
    const email = body.email || null;
    const phone = body.phone || null;

    const profile = await store.createResumeProfile(userId, {
      targetRole: body.targetRole,
      careerGoal: body.careerGoal,
      location: body.location,
      status: "collecting_information",
      currentSection: "career_goal",
      // Server stamps the timestamp + the version it currently serves, so the
      // recorded consent can't be spoofed or point at an unknown text version.
      termsAcceptedAt: new Date().toISOString(),
      termsVersion: TERMS_VERSION,
    });
    // Written immediately after the profile row so the record is contactable from
    // birth. The funnel's `personal_name` / `personal_contact` questions are
    // guarded by `!hasName(s)` / `!hasContact(s)`, so they now self-skip.
    await store.upsertPersonalInformation(profile.id, {
      firstName: name.firstName,
      lastName: name.lastName,
      email,
      phone,
    });
    await store.upsertQuestionState(profile.id, { activeSection: "career_goal" });

    analytics.track("resume_funnel_started", { resumeProfileId: profile.id }, userId);

    const state = await assembleProfileState(store, profile.id);
    return created({ profile, state });
  });
}

/** GET /api/resume-profiles — list the caller's profiles. */
export async function GET() {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    const profiles = await store.listResumeProfilesByUser(userId);
    return ok({ profiles });
  });
}
