import { handleRoute, created, ok } from "@/lib/http";
import { getRequestContext, loadOwnedProfile } from "@/lib/request-context";
import { MAX_RESUME_ITERATIONS } from "@/lib/config/limits";
import { RecordIterationAnswerBody } from "@/lib/validation/api-schemas";
import { readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

/**
 * The improvement round's question/answer log — one table per round
 * (`iteration_1..3`).
 *
 * The answer itself is applied to the profile by the normal pipeline
 * (`/answers`, `/enrich-entry`, `/interests/extract`); this records *what was
 * asked and what came back*, which those endpoints do not capture because they
 * only ever see a raw answer with no question text attached.
 */

/** GET — the current round number and every round's logged Q&A. */
export async function GET(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);

    const iteration = await store.getIteration(params.id);
    const rounds = await Promise.all(
      Array.from({ length: MAX_RESUME_ITERATIONS }, (_, i) =>
        store.listIterationAnswers(params.id, i + 1),
      ),
    );
    return ok({ iteration, rounds });
  });
}

/** POST — log one question/answer into the round currently being filled in. */
export async function POST(request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { userId, store } = await getRequestContext();
    await loadOwnedProfile(store, params.id, userId);
    const body = RecordIterationAnswerBody.parse(await readJson(request));

    // Answers land in the round the user is *filling*, which is one past the
    // number completed. Clamped so a client that keeps answering at the cap
    // appends to the last round rather than addressing a table that isn't there.
    const completed = await store.getIteration(params.id);
    const round = Math.min(MAX_RESUME_ITERATIONS, completed + 1);

    const entry = await store.recordIterationAnswer(params.id, round, body);
    return created({ entry });
  });
}
