import { handleRoute, ok, readJson } from "@/lib/http";
import { Errors } from "@/lib/errors";
import { assertOwnsProfileId, getRequestContext } from "@/lib/request-context";
import { UpdateEducationBody } from "@/lib/validation/api-schemas";

export const dynamic = "force-dynamic";

type Params = { params: { entryId: string } };

/** PATCH /api/education/:entryId — edit an education entry (marks it edited). */
export async function PATCH(request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    const existing = await store.getEducation(params.entryId);
    if (!existing) throw Errors.notFound("Entrada de educación no encontrada");
    await assertOwnsProfileId(store, existing.resumeProfileId, userId);

    const body = UpdateEducationBody.parse(await readJson(request));
    const entry = await store.updateEducation(params.entryId, {
      ...body,
      confirmationStatus: body.confirmationStatus ?? "edited",
    });
    return ok({ entry });
  });
}

/** DELETE /api/education/:entryId */
export async function DELETE(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    const existing = await store.getEducation(params.entryId);
    if (!existing) throw Errors.notFound("Entrada de educación no encontrada");
    await assertOwnsProfileId(store, existing.resumeProfileId, userId);
    await store.deleteEducation(params.entryId);
    return ok({ deleted: true });
  });
}
