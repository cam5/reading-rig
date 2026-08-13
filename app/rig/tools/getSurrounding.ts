import type { PrismaClient } from "../../../generated/prisma/client";
import { bookmarkWhereClause } from "../../domain/reading/bookmark";
import {
  fetchBookmarkGlobalOrdinal,
  fetchOwnedParagraph,
  isWithinBookmark,
  paragraphInclude,
  toPassage,
  type Passage,
} from "./shared";

export type GetSurroundingInput = {
  userId: string;
  paragraphId: string;
  /** paragraphs to fetch immediately before the target, in reading order */
  before: number;
  /** paragraphs to fetch immediately after the target, in reading order */
  after: number;
};

export type SurroundingResult = {
  target: Passage;
  before: Passage[];
  after: Passage[];
};

/**
 * get_passage plus the paragraphs immediately around it, for when the
 * agent needs a little more than one paragraph of context.
 *
 * Same bookmark discipline as get_passage for the target itself — null if
 * it can't be seen. The "before" side never needs its own bookmark check:
 * every paragraph before an in-bookmark target has a smaller globalOrdinal,
 * so it's already within the boundary. The "after" side is where the
 * boundary actually bites — it's clipped with the same `bookmarkWhereClause`
 * search_shelf uses (#10), so asking for `after: 5` right at the bookmark
 * silently returns fewer than 5, never paragraphs past it.
 */
export async function getSurrounding(
  db: PrismaClient,
  { userId, paragraphId, before, after }: GetSurroundingInput,
): Promise<SurroundingResult | null> {
  const paragraph = await fetchOwnedParagraph(db, userId, paragraphId);
  if (!paragraph) return null;

  const workId = paragraph.section.chapter.work.id;
  const bookmarkGlobalOrdinal = await fetchBookmarkGlobalOrdinal(
    db,
    userId,
    workId,
  );
  if (!isWithinBookmark(paragraph.globalOrdinal, bookmarkGlobalOrdinal))
    return null;

  const beforeRows =
    before > 0
      ? await db.paragraph.findMany({
          where: {
            section: { chapter: { workId } },
            globalOrdinal: { lt: paragraph.globalOrdinal },
          },
          orderBy: { globalOrdinal: "desc" },
          take: before,
          include: paragraphInclude,
        })
      : [];

  const afterRows =
    after > 0
      ? await db.paragraph.findMany({
          where: {
            section: { chapter: { workId } },
            // Merged into one globalOrdinal comparison, not spread after a
            // sibling `globalOrdinal` key — Prisma's `where` is a plain
            // object, so a second key of the same name silently overwrites
            // the first rather than combining the two conditions.
            globalOrdinal: {
              gt: paragraph.globalOrdinal,
              ...bookmarkWhereClause(bookmarkGlobalOrdinal).globalOrdinal,
            },
          },
          orderBy: { globalOrdinal: "asc" },
          take: after,
          include: paragraphInclude,
        })
      : [];

  return {
    target: toPassage(paragraph),
    // beforeRows came back newest-first (closest to the target first) so
    // `take` grabs the *nearest* paragraphs when there are more than
    // asked for; reversed here so the result reads in reading order.
    before: beforeRows.reverse().map(toPassage),
    after: afterRows.map(toPassage),
  };
}
