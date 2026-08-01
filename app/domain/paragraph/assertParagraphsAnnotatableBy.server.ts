import type { PrismaClient } from "../../../generated/prisma/client";

/**
 * The access boundary every mutation in the read action enforces: a
 * paragraph only exists for a given request if it resolves back to a Work
 * this user may annotate. Throws the same 404 whether one paragraph is
 * missing or all of them are, and checks every id a spanning highlight
 * touches — not just the first — so a request can't sneak in a paragraph
 * from someone else's book by hiding it behind one that's actually
 * annotatable.
 *
 * Today this is exactly "the user owns the Work" — the `ownerId` check
 * below — because there's no way yet for a non-owner to be granted access
 * to one. That's the one line that changes when sharing/granting exists;
 * every call site stays the same.
 */
export async function assertParagraphsAnnotatableBy(
  db: Pick<PrismaClient, "paragraph">,
  userId: string,
  paragraphIds: string[],
): Promise<void> {
  const annotatable = await db.paragraph.findMany({
    where: { id: { in: paragraphIds }, section: { chapter: { work: { ownerId: userId } } } },
  });
  if (annotatable.length !== paragraphIds.length) {
    throw new Response("Not found", { status: 404 });
  }
}
