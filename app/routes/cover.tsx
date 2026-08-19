import { db } from "~/db.server";
import { requireApiUser } from "~/user.server";
import { fetchOwnedWork } from "~/domain/reading/assertWorkReadableBy.server";
import type { Route } from "./+types/cover";

/**
 * Serves a Work's cover image straight out of the DB (Work.coverImage /
 * coverMediaType — see parseEpub.ts's `cover` extraction and
 * persistWork.server.ts). Splat, not `:workId`, for the same reason
 * read/* is: a workId is a slash-shaped slug
 * (`karl-marx/capital-volume-i@abc123`), which a single dynamic segment
 * can't match.
 *
 * requireApiUser, not requireUser: this route lives outside /api/v1 (an
 * <img src> has to hit a plain URL, not a JSON endpoint), but the iOS
 * client's shelf needs cover thumbnails too, and it only ever carries a
 * Bearer token — requireUser's redirect-to-login-on-failure would hand it
 * back an HTML page instead of a 401. Same dual-credential check
 * every /api/v1 route already gets, just applied here too.
 */
export async function loader({ params, request }: Route.LoaderArgs) {
  const user = await requireApiUser(request);
  const workId = params["*"];
  const work = await fetchOwnedWork(db, user.id, workId);

  if (!work.coverImage || !work.coverMediaType) {
    throw new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(work.coverImage), {
    headers: {
      "Content-Type": work.coverMediaType,
      // workId already forks on edition/bytes change (hashEdition in
      // parseEpub.ts), so this URL's bytes never change under a reader —
      // safe to cache indefinitely.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
