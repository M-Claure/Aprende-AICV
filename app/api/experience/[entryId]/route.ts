import { handleRoute, ok, readJson } from "@/lib/http";
import { Errors } from "@/lib/errors";
import { assertOwnsProfileId, getRequestContext } from "@/lib/request-context";
import { UpdateExperienceBody } from "@/lib/validation/api-schemas";

export const dynamic = "force-dynamic";

type Params = { params: { entryId: string } };

/** PATCH /api/experience/:entryId — edit an experience entry (marks it edited). */
export async function PATCH(request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    const existing = await store.getExperience(params.entryId);
    if (!existing) throw Errors.notFound("Entrada de experiencia no encontrada");
    await assertOwnsProfileId(store, existing.resumeProfileId, userId);

    const body = UpdateExperienceBody.parse(await readJson(request));
    const entry = await store.updateExperience(params.entryId, {
      ...body,
      confirmationStatus: body.confirmationStatus ?? "edited",
    });
    return ok({ entry });
  });
}

/** DELETE /api/experience/:entryId */
export async function DELETE(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    const existing = await store.getExperience(params.entryId);
    if (!existing) throw Errors.notFound("Entrada de experiencia no encontrada");
    await assertOwnsProfileId(store, existing.resumeProfileId, userId);
    await store.deleteExperience(params.entryId);
    return ok({ deleted: true });
  });
}
