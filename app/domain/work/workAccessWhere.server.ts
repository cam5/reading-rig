import type { Prisma } from "../../../generated/prisma/client";

/**
 * The single fragment every "may this user act on this Work" check splices
 * into a Prisma `where` — ownerId (the original single-owner model) OR a
 * WorkGrant row (#132's follow-up: seed-library books granted at sign-in).
 * The one place that changes if grants grow richer later (expiring,
 * per-work roles, revocation); every call site just imports this instead of
 * hand-rolling `ownerId: userId`.
 */
export function workAccessWhere(userId: string): Prisma.WorkWhereInput {
  return {
    OR: [{ ownerId: userId }, { grants: { some: { userId } } }],
  };
}
