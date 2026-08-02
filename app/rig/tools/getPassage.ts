import type { PrismaClient } from "../../../generated/prisma/client";
import { fetchBookmarkGlobalOrdinal, fetchOwnedParagraph, isWithinBookmark, toPassage, type Passage } from "./shared";

export type GetPassageInput = {
  userId: string;
  paragraphId: string;
};

/**
 * The agent's most basic read: one paragraph, with enough of its
 * section/chapter/work to derive a locator.
 *
 * Bookmark-checked even though the issue only names search_shelf as
 * "bookmark-bounded" — the build plan frames "nothing past your bookmark"
 * as a property of the reading API as a whole ("every retrieval query...
 * the agent cannot see past it because the query never returns it"), not
 * a rule specific to search. A paragraphId is just as capable of pointing
 * past what's been read as a search query is, so this checks the same way.
 *
 * Returns null — never a partial or redacted passage — for: no such
 * paragraph, a paragraph belonging to another user's work, or a paragraph
 * past the reader's bookmark. All three look identical to the caller on
 * purpose; the agent has no way to distinguish "doesn't exist" from
 * "exists but you haven't read that far".
 */
export async function getPassage(db: PrismaClient, { userId, paragraphId }: GetPassageInput): Promise<Passage | null> {
  const paragraph = await fetchOwnedParagraph(db, userId, paragraphId);
  if (!paragraph) return null;

  const workId = paragraph.section.chapter.work.id;
  const bookmarkGlobalOrdinal = await fetchBookmarkGlobalOrdinal(db, userId, workId);
  if (!isWithinBookmark(paragraph.globalOrdinal, bookmarkGlobalOrdinal)) return null;

  return toPassage(paragraph);
}
