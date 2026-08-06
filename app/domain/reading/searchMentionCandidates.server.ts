import type { PrismaClient } from "../../../generated/prisma/client";
import { paragraphInclude, toPassage, type Passage } from "../../rig/tools/shared";
import { bookmarkWhereClause } from "./bookmark";

export const MENTION_SUGGESTION_LIMIT = 8;

export type SearchMentionCandidatesInput = {
  userId: string;
  workId: string;
  query: string;
  bookmarkGlobalOrdinal: number;
  limit?: number;
};

/**
 * Candidates for the composer's "@" autocomplete — same substring-match-plus-
 * no-spoiler shape as search_shelf, but for a live-as-you-type popup rather
 * than an agent tool call: capped at `limit` and ordered closest-to-bookmark
 * first instead of reading order, so the paragraphs a reader is most likely
 * to be talking about surface at the top of a short list.
 *
 * Deliberately a fork of search_shelf, not a shared mode flag on it — that
 * handler's asc/no-limit ordering reads as intentional for the agent's own
 * use (reading order, not relevance), and this endpoint fires on every
 * keystroke rather than once per tool call, so it shouldn't risk changing
 * that behavior by accident.
 */
export async function searchMentionCandidates(
  db: PrismaClient,
  { userId, workId, query, bookmarkGlobalOrdinal, limit = MENTION_SUGGESTION_LIMIT }: SearchMentionCandidatesInput,
): Promise<Passage[]> {
  const rows = await db.paragraph.findMany({
    where: {
      section: { chapter: { workId, work: { ownerId: userId } } },
      text: { contains: query.trim() },
      ...bookmarkWhereClause(bookmarkGlobalOrdinal),
    },
    // Every candidate row already satisfies globalOrdinal <= bookmark (the
    // where clause above), so abs(globalOrdinal - bookmark) is monotonically
    // decreasing in globalOrdinal — "closest first" is just desc order, no
    // JS-side distance sort needed. A blank query (`contains("")` matches
    // everything in bounds) therefore surfaces "paragraphs nearest your
    // bookmark" as the default list before the user types anything, same as
    // a bare "@" in Slack/Notion — intentional, not incidental.
    orderBy: { globalOrdinal: "desc" },
    take: limit,
    include: paragraphInclude,
  });

  return rows.map(toPassage);
}
