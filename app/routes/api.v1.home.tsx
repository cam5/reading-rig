import { db } from "~/db.server";
import { requireApiUser } from "~/user.server";
import { fetchShelf } from "~/domain/work/fetchShelf.server";
import { homeResponseSchema } from "~/domain/api/schemas/home.server";
import type { Route } from "./+types/api.v1.home";

/**
 * JSON counterpart to home.tsx's page loader — same fetchShelf call, same
 * shape, for a non-browser client. See app/routes.ts's /api/v1 comment for
 * why this exists as a separate route rather than home.tsx itself: that
 * route's loader return goes over RR8's single-fetch turbo-stream wire
 * format on `.data` requests, not plain JSON.
 *
 * The trailing `.parse()` checks this route's own output against its
 * declared contract before it ever reaches a client — a genuine shape
 * drift here is a bug in this route, not a client input problem, so it's
 * left to throw (500) rather than caught like a request-validation
 * failure would be.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireApiUser(request);
  const works = await fetchShelf(db, user.id);
  return homeResponseSchema.parse({ userId: user.id, works });
}
