import { db } from "~/db.server";
import { requireApiUser } from "~/user.server";
import { fetchReadPageData } from "~/domain/reading/fetchReadPageData.server";
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
  const sectionIdParam = new URL(request.url).searchParams.get("section");
  return fetchReadPageData(db, user.id, workId, sectionIdParam);
}
