import { db } from "~/db.server";
import { requireApiUser } from "~/user.server";
import { canonicalRequestUrl, analyticsClientFor } from "~/analytics.server";
import { fetchReadPageData } from "~/domain/reading/fetchReadPageData.server";
import { handleReadAction } from "~/domain/reading/handleReadAction.server";
import { parseOrBadRequest } from "~/domain/api/errors.server";
import {
  readActionRequestSchema,
  readActionResponseSchema,
  readLoaderQuerySchema,
  readResponseSchema,
} from "~/domain/api/schemas/read.server";
import type { Route } from "./+types/api.v1.read";

/**
 * JSON counterpart to read.tsx's page loader — same fetchReadPageData
 * call (work outline, structural paragraphs, initial content window,
 * bookmark, progress), same `?section=` handling, same splat-for-
 * slash-shaped-workId convention as read/* itself (see app/routes.ts).
 *
 * Doesn't fire the `work_opened` analytics event read.tsx's own loader
 * does — see fetchReadPageData's doc comment for why that's left as an
 * open question rather than silently ported over here.
 */
export async function loader({ params, request }: Route.LoaderArgs) {
  const user = await requireApiUser(request);
  const workId = params["*"];
  const { section } = parseOrBadRequest(readLoaderQuerySchema, {
    section: new URL(request.url).searchParams.get("section"),
  });
  const data = await fetchReadPageData(db, user.id, workId, section);
  return readResponseSchema.parse(data);
}

/**
 * JSON counterpart to read.tsx's page action — same handleReadAction
 * dispatch (the `highlight`, `highlight-note`, `note`, and `bookmark`
 * intents a highlight/note-composer POST or the bookmark tracker's
 * fetcher.submit sends), same FormData shape (an `intent` field plus
 * whatever that intent needs — see handleReadAction.server.ts). This is
 * the only way any of those get made; the Rig stays read-only (see the
 * build plan's margin-is-the-only-write invariant), and there is no
 * separate write path for a native client to reach.
 *
 * readActionRequestSchema only checks *shape* (does this look like a
 * `highlight` request at all) — it's validated here, ahead of
 * handleReadAction, purely so a malformed request from a JSON client
 * gets a structured 400 instead of an unhandled JSON.parse throw.
 * handleReadAction still re-derives everything from the same `formData`
 * itself and still owns the actual business rules ("a note needs a
 * body") — this doesn't replace that, and read.tsx's page action (which
 * skips this schema) is unaffected.
 */
export async function action({ request }: Route.ActionArgs) {
  const user = await requireApiUser(request);
  const formData = await request.formData();
  parseOrBadRequest(
    readActionRequestSchema,
    Object.fromEntries(formData.entries()),
  );
  const result = await handleReadAction(
    db,
    user,
    formData,
    canonicalRequestUrl(request),
    analyticsClientFor(request),
  );
  return readActionResponseSchema.parse(result);
}
