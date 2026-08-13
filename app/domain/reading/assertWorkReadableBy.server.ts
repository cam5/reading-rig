import type { PrismaClient } from "../../../generated/prisma/client";

/**
 * The access boundary both `read.tsx`'s loader and `read-content.tsx`'s
 * loader enforce before returning anything about a Work: today, exactly
 * "the user owns it" (ownerId) — same one-line-changes-when-sharing-exists
 * reasoning as assertParagraphsAnnotatableBy.server.ts's own doc comment.
 * Throws the same 404 whether the id doesn't exist at all or belongs to
 * someone else, so a probing request can't distinguish the two.
 */
export async function assertWorkReadableBy(
  db: Pick<PrismaClient, "work">,
  userId: string,
  workId: string,
): Promise<void> {
  const work = await db.work.findFirst({
    where: { id: workId, ownerId: userId },
    select: { id: true },
  });
  if (!work) throw new Response("Not found", { status: 404 });
}
