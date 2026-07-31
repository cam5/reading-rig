import type { PrismaClient } from "../../../generated/prisma/client";

/**
 * The ownership boundary every mutation in the read action enforces: a
 * paragraph only exists for a given request if it resolves back to the
 * requesting user's own work. Throws the same 404 whether one paragraph is
 * missing or all of them are, and checks every id a spanning highlight
 * touches — not just the first — so a request can't sneak in a paragraph
 * from someone else's book by hiding it behind one that's actually owned.
 */
export async function assertOwnsParagraphs(
  db: Pick<PrismaClient, "paragraph">,
  userId: string,
  paragraphIds: string[],
): Promise<void> {
  const owned = await db.paragraph.findMany({
    where: { id: { in: paragraphIds }, section: { chapter: { work: { userId } } } },
  });
  if (owned.length !== paragraphIds.length) {
    throw new Response("Not found", { status: 404 });
  }
}
