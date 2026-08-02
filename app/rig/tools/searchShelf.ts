import type { PrismaClient } from "../../../generated/prisma/client";
import { bookmarkWhereClause } from "../../domain/reading/bookmark";
import { paragraphInclude, toPassage, type Passage } from "./shared";

export type SearchShelfInput = {
  userId: string;
  workId: string;
  query: string;
  /** The reader's bookmark for this work, as a globalOrdinal — resolved by
   * the caller (the session layer, #17) the same way read.tsx's loader
   * does, and handed in rather than re-derived here so this handler stays
   * a plain query over the value it's given. */
  bookmarkGlobalOrdinal: number;
};

/**
 * Text search within one work's paragraphs, bounded by the reader's own
 * bookmark — the handler #10's bookmark.ts was built for. `bookmarkWhereClause`
 * is spliced directly into the Prisma `where`, so a paragraph past the
 * bookmark is never a candidate row in the first place: this isn't a filter
 * applied to results after the fact, it's the query itself.
 *
 * Also scoped to `workId` and to paragraphs whose work belongs to `userId`
 * — the same ownership chain every other route/handler in this repo walks
 * (paragraph -> section -> chapter -> work -> userId).
 */
export async function searchShelf(
  db: PrismaClient,
  { userId, workId, query, bookmarkGlobalOrdinal }: SearchShelfInput,
): Promise<Passage[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const rows = await db.paragraph.findMany({
    where: {
      section: { chapter: { workId, work: { ownerId: userId } } },
      text: { contains: trimmed },
      ...bookmarkWhereClause(bookmarkGlobalOrdinal),
    },
    orderBy: { globalOrdinal: "asc" },
    include: paragraphInclude,
  });

  return rows.map(toPassage);
}
