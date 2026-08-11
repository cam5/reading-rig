import { db } from "./db.server";
import { requireUserId } from "./auth/session.server";
import type { PrismaClient } from "../generated/prisma/client";

/**
 * The one seam anything reaches through to find out who "you" are.
 *
 * Reads the session cookie (app/auth/session.server.ts's requireUserId) and
 * resolves it to a User row. No call site should ever query the User model
 * or the session directly — this is the only place that decides who's
 * signed in.
 *
 * requireUserId throws a redirect to /auth/login when there's no session,
 * so a call site never sees a missing user — same failure shape as before
 * (this used to throw if the seed hadn't been run), just a real redirect
 * instead of a setup error.
 *
 * Standalone scripts (outside the app's request lifecycle) don't have the
 * app's cached `db` singleton available, so they can pass their own client.
 */
export async function requireUser(request: Request, client: Pick<PrismaClient, "user"> = db) {
  const userId = await requireUserId(request);
  return client.user.findUniqueOrThrow({ where: { id: userId } });
}
