import { db } from "~/db.server";
import { assertWorkReadableBy } from "~/domain/reading/assertWorkReadableBy.server";
import { searchMentionCandidates } from "~/domain/reading/searchMentionCandidates.server";
import { fetchBookmarkGlobalOrdinal } from "~/rig/tools/shared";
import { requireUser } from "~/user.server";
import type { Route } from "./+types/mention-suggestions";

/**
 * Loader-only — TokenComposer's "@" autocomplete (useMentionCandidates)
 * calls this as the reader types a mention query. `q` is the text typed
 * after "@", may be empty (a bare "@" asks for "what's closest to my
 * bookmark"). Same request shape as read-content.tsx: URLSearchParams, not
 * a JSON body, since this is a GET a client-side fetcher issues on every
 * keystroke.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const workId = url.searchParams.get("work");
  const query = url.searchParams.get("q");
  if (!workId || query === null) {
    throw new Response("Bad request", { status: 400 });
  }

  await assertWorkReadableBy(db, user.id, workId);

  try {
    const bookmarkGlobalOrdinal = await fetchBookmarkGlobalOrdinal(
      db,
      user.id,
      workId,
    );
    const suggestions = await searchMentionCandidates(db, {
      userId: user.id,
      workId,
      query,
      bookmarkGlobalOrdinal,
    });
    return { suggestions };
  } catch (error) {
    // This route has no ErrorBoundary of its own, and this app has none
    // between here and root.tsx's — a thrown loader error from a
    // useFetcher().load() bubbles all the way up and tears down the whole
    // page, not just the composer. Fine for the bad-request/ownership
    // checks above (those indicate a real bug and should be loud), but
    // this call fires on nearly every keystroke while composing a message,
    // so a transient DB hiccup shouldn't be able to end the reading
    // session over it — degrade to "no suggestions this keystroke" instead.
    console.error(
      "mention-suggestions: search failed, returning no suggestions",
      error,
    );
    return { suggestions: [] };
  }
}
