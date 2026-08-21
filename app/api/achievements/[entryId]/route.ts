import { handleRoute, ok, readJson } from "@/lib/http";
import { Errors } from "@/lib/errors";
import { assertOwnsProfileId, getRequestContext } from "@/lib/request-context";
import { UpdateAchievementBody } from "@/lib/validation/api-schemas";

export const dynamic = "force-dynamic";

type Params = { params: { entryId: string } };

/**
 * PATCH /api/achievements/:entryId — edit one logro.
 *
 * Ownership is checked the same way every flat entity route checks it: load the
 * entry, then assert the caller owns the profile it belongs to. A missing entry is
 * a 404 rather than a 403, so one account cannot probe another's ids.
 */
export async function PATCH(request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    const existing = await store.getAchievement(params.entryId);
    if (!existing) throw Errors.notFound("Logro no encontrado");
    await assertOwnsProfileId(store, existing.resumeProfileId, userId);

    const body = UpdateAchievementBody.parse(await readJson(request));
    const entry = await store.updateAchievement(params.entryId, {
      ...body,
      // Editing marks the entry `edited`, which is résumé-eligible — the same rule
      // education and experience follow (`RESUME_ELIGIBLE_CONFIRMATIONS`).
      confirmationStatus: body.confirmationStatus ?? "edited",
    });
    return ok({ entry });
  });
}

/** DELETE /api/achievements/:entryId — remove it, so a wrong one never reaches the PDF. */
export async function DELETE(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    const existing = await store.getAchievement(params.entryId);
    if (!existing) throw Errors.notFound("Logro no encontrado");
    await assertOwnsProfileId(store, existing.resumeProfileId, userId);
    await store.deleteAchievement(params.entryId);
    return ok({ deleted: true });
  });
}
