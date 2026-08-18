import { db } from "~/db.server";
import { requireApiUser } from "~/user.server";
import { fetchShelf } from "~/domain/work/fetchShelf.server";
import type { Route } from "./+types/api.v1.home";

/**
 * JSON counterpart to home.tsx's page loader — same fetchShelf call, same
 * shape, for a non-browser client. See app/routes.ts's /api/v1 comment for
 * why this exists as a separate route rather than home.tsx itself: that
 * route's loader return goes over RR8's single-fetch turbo-stream wire
 * format on `.data` requests, not plain JSON.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireApiUser(request);
  const works = await fetchShelf(db, user.id);
  return { userId: user.id, works };
}
