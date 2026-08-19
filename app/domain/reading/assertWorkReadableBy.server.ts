import type { PrismaClient } from "../../../generated/prisma/client";
import { workAccessWhere } from "../work/workAccessWhere.server";

/**
 * The access boundary both `read.tsx`'s loader and `api.v1.read-content.tsx`'s
 * loader enforce before returning anything about a Work: ownership OR a
 * WorkGrant row — see workAccessWhere.server.ts, the seam this used to
 * hand-roll as a bare `ownerId` check before grants existed. Throws the
 * same 404 whether the id doesn't exist at all or belongs to someone else,
 * so a probing request can't distinguish the two.
 */
export async function assertWorkReadableBy(
  db: Pick<PrismaClient, "work">,
  userId: string,
  workId: string,
): Promise<void> {
  const work = await db.work.findFirst({
    where: { id: workId, ...workAccessWhere(userId) },
    select: { id: true },
  });
  if (!work) throw new Response("Not found", { status: 404 });
}

/**
 * Same access boundary as `assertWorkReadableBy` above, for the callers
 * that need the row itself (a title to display, a relation to include)
 * rather than just the yes/no check — `api.v1.rig.tsx` and `api.v1.rig-sessions.tsx`
 * both used to hand-roll this exact query under their own
 * `requireOwnedWork` name.
 */
export async function fetchOwnedWork(
  db: Pick<PrismaClient, "work">,
  userId: string,
  workId: string,
) {
  const work = await db.work.findFirst({
    where: { id: workId, ...workAccessWhere(userId) },
  });
  if (!work) throw new Response("Not found", { status: 404 });
  return work;
}
