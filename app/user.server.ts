import { db } from "./db.server";
import type { PrismaClient } from "../generated/prisma/client";

/**
 * The one seam anything reaches through to find out who "you" are.
 *
 * Today this is a personal tool with a single seeded row (see
 * prisma/seed.ts), so it's the oldest User in the table — there is only
 * ever one. When real auth arrives, this function's body is the only place
 * that changes: it starts reading a session instead. No call site should
 * ever query the User model directly, and none should assume anything
 * about how the current user is determined.
 *
 * Throws rather than returning null if the seed hasn't been run — for a
 * personal tool that's a setup error worth surfacing loudly, and it's the
 * same failure shape real auth will have (no session -> reject) rather
 * than a special case only this seam needs to handle.
 *
 * Standalone scripts (outside the app's request lifecycle) don't have the
 * app's cached `db` singleton available, so they can pass their own client.
 */
export async function requireUser(client: Pick<PrismaClient, "user"> = db) {
  return client.user.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
}
