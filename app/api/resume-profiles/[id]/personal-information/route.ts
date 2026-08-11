import { handleRoute, ok, readJson } from "@/lib/http";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { PatchPersonalInfoBody } from "@/lib/validation/api-schemas";

export const dynamic = "force-dynamic";

/** PATCH /api/resume-profiles/:id/personal-information — edit name/contact/location. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);
    const body = PatchPersonalInfoBody.parse(await readJson(request));

    const personalInformation = await store.upsertPersonalInformation(params.id, {
      firstName: body.firstName ?? undefined,
      lastName: body.lastName ?? undefined,
      city: body.city ?? undefined,
      state: body.state ?? undefined,
      country: body.country ?? undefined,
      phone: body.phone ?? undefined,
      email: body.email ?? undefined,
      linkedInUrl: body.linkedInUrl ?? undefined,
      portfolioUrl: body.portfolioUrl ?? undefined,
    });
    return ok({ personalInformation });
  });
}
