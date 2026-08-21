import { handleRoute, ok, readJson } from "@/lib/http";
import { Errors } from "@/lib/errors";
import { assertOwnsProfileId, getRequestContext } from "@/lib/request-context";
import { UpdateLanguageBody } from "@/lib/validation/api-schemas";

export const dynamic = "force-dynamic";

type Params = { params: { entryId: string } };

/**
 * PATCH /api/languages/:entryId — edit one idioma.
 *
 * A language has no `confirmationStatus`. Whether it prints is decided by
 * `includeOnResume` alone (`resume-generator.ts` filters on it), which is why this
 * body can set that flag and the other three routes' bodies cannot.
 *
 * Ownership is checked the same way every flat entity route checks it: load the
 * entry, then assert the caller owns the profile it belongs to. A missing entry is
 * a 404 rather than a 403, so one account cannot probe another's ids.
 */
export async function PATCH(request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    const existing = await store.getLanguage(params.entryId);
    if (!existing) throw Errors.notFound("Idioma no encontrado");
    await assertOwnsProfileId(store, existing.resumeProfileId, userId);

    const body = UpdateLanguageBody.parse(await readJson(request));
    const entry = await store.updateLanguage(params.entryId, body);
    return ok({ entry });
  });
}

/** DELETE /api/languages/:entryId — remove it, so a wrong one never reaches the PDF. */
export async function DELETE(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    const existing = await store.getLanguage(params.entryId);
    if (!existing) throw Errors.notFound("Idioma no encontrado");
    await assertOwnsProfileId(store, existing.resumeProfileId, userId);
    await store.deleteLanguage(params.entryId);
    return ok({ deleted: true });
  });
}
