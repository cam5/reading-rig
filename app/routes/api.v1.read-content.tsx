import { db } from "~/db.server";
import { requireApiUser } from "~/user.server";
import { assertWorkReadableBy } from "~/domain/reading/assertWorkReadableBy.server";
import { fetchContentWindow } from "~/domain/reading/fetchContentWindow.server";
import { parseOrBadRequest } from "~/domain/api/errors.server";
import {
  readContentQuerySchema,
  readContentResponseSchema,
} from "~/domain/api/schemas/readContent.server";
import type { Route } from "./+types/api.v1.read-content";

/**
 * Loader-only — `useContentWindow` (app/components/useContentWindow.ts)
 * calls this as the reader's mounted DOM window approaches either edge of
 * what's already been fetched. `min`/`max` arrive pre-computed
 * client-side (extendContentWindow, which has the structural array and
 * does the byte-budget walk) — this endpoint's job is just "give me
 * exactly this range," the same contract read.tsx's own loader uses for
 * the initial window, via the same fetchContentWindow helper.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireApiUser(request);
  const url = new URL(request.url);
  const { work, min, max } = parseOrBadRequest(
    readContentQuerySchema,
    Object.fromEntries(url.searchParams),
  );

  await assertWorkReadableBy(db, user.id, work);
  const paragraphs = await fetchContentWindow(db, work, {
    minGlobalOrdinal: min,
    maxGlobalOrdinal: max,
  });
  return readContentResponseSchema.parse({ paragraphs });
}

// Never auto-revalidated: this loader is only ever reached via an explicit
// fetcher.load(url) — useDirectionalFetch on scroll, useParagraphRefresh
// after a save — each of which already re-fetches on its own terms.
// Without this, React Router's default "revalidate every active fetcher
// after any action" behavior refetches whatever range this fetcher last
// loaded every time an unrelated action runs anywhere on the page (e.g. a
// second highlight/note save while this one's own last response is still
// the fetcher's active data) — a response for a stale min/max can then
// land and get merged just as useParagraphRefresh's own pendingRangeRef
// has moved on to a newer range, corrupting contentById with the wrong
// paragraph's data under that range's key.
export function shouldRevalidate() {
  return false;
}
