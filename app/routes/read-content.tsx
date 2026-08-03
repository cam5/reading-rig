import { db } from "~/db.server";
import { requireUser } from "~/user.server";
import { assertWorkReadableBy } from "~/domain/reading/assertWorkReadableBy.server";
import { fetchContentWindow } from "~/domain/reading/fetchContentWindow.server";
import type { Route } from "./+types/read-content";

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
  const user = await requireUser();
  const url = new URL(request.url);
  const workId = url.searchParams.get("work");
  // `.get()` returns `null` for an absent param — checked as a string
  // before coercing, since `Number(null)` is `0`, a perfectly finite
  // number that would otherwise let a missing min/max silently become a
  // (wrong) real range instead of the 400 a malformed request should get.
  const minParam = url.searchParams.get("min");
  const maxParam = url.searchParams.get("max");
  if (!workId || minParam === null || maxParam === null) {
    throw new Response("Bad request", { status: 400 });
  }
  const min = Number(minParam);
  const max = Number(maxParam);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Response("Bad request", { status: 400 });
  }

  await assertWorkReadableBy(db, user.id, workId);
  const paragraphs = await fetchContentWindow(db, workId, { minGlobalOrdinal: min, maxGlobalOrdinal: max });
  return { paragraphs };
}
