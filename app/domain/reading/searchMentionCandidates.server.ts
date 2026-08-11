import type { PrismaClient } from "../../../generated/prisma/client";
import { entryInclude, paragraphInclude, toNoteMatch, toPassage, type NoteMatch, type Passage } from "../../rig/tools/shared";
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
 * A single row in the composer's "@" popup: a paragraph, or (unified search,
 * #117 follow-up) a margin note whose body matches the same query. Ranked
 * together by closest-to-bookmark, so a note surfaces alongside the
 * paragraphs it's near rather than in a separate, unranked section.
 */
export type MentionCandidate = { kind: "paragraph"; passage: Passage } | { kind: "note"; note: NoteMatch };

function candidateGlobalOrdinal(candidate: MentionCandidate): number {
  return candidate.kind === "paragraph" ? candidate.passage.globalOrdinal : candidate.note.globalOrdinal;
}

/**
 * Candidates for the composer's "@" autocomplete — same substring-match-plus-
 * no-spoiler shape as search_shelf, but for a live-as-you-type popup rather
 * than an agent tool call: capped at `limit` and ordered closest-to-bookmark
 * first instead of reading order, so the paragraphs (and, now, notes) a
 * reader is most likely to be talking about surface at the top of a short
 * list.
 *
 * Deliberately a fork of search_shelf, not a shared mode flag on it — that
 * handler's asc/no-limit ordering reads as intentional for the agent's own
 * use (reading order, not relevance), and this endpoint fires on every
 * keystroke rather than once per tool call, so it shouldn't risk changing
 * that behavior by accident.
 *
 * Paragraphs and notes are fetched as two independent top-`limit` queries,
 * each already bookmark-bounded and closest-first, then merged and re-cut
 * to `limit`: a candidate that lands in the true global top-`limit` is
 * guaranteed to be within its own type's top-`limit` too, so nothing gets
 * missed by not doing this as one combined query (which Prisma has no way
 * to express across two tables anyway).
 */
export async function searchMentionCandidates(
  db: PrismaClient,
  { userId, workId, query, bookmarkGlobalOrdinal, limit = MENTION_SUGGESTION_LIMIT }: SearchMentionCandidatesInput,
): Promise<MentionCandidate[]> {
  const trimmed = query.trim();

  const [paragraphs, entries] = await Promise.all([
    db.paragraph.findMany({
      where: {
        section: { chapter: { workId, work: { ownerId: userId } } },
        text: { contains: trimmed },
        ...bookmarkWhereClause(bookmarkGlobalOrdinal),
      },
      orderBy: { globalOrdinal: "desc" },
      take: limit,
      include: paragraphInclude,
    }),
    db.entry.findMany({
      where: {
        body: { contains: trimmed },
        anchorParagraph: {
          section: { chapter: { workId, work: { ownerId: userId } } },
          ...bookmarkWhereClause(bookmarkGlobalOrdinal),
        },
      },
      orderBy: { anchorParagraph: { globalOrdinal: "desc" } },
      take: limit,
      include: entryInclude,
    }),
  ]);

  const candidates: MentionCandidate[] = [
    ...paragraphs.map((p) => ({ kind: "paragraph" as const, passage: toPassage(p) })),
    ...entries.map((e) => ({ kind: "note" as const, note: toNoteMatch(e) })),
  ];

  // Every candidate row already satisfies globalOrdinal <= bookmark (both
  // where clauses above), so this desc sort is "closest first" directly —
  // same reasoning searchMentionCandidates always used for paragraphs alone,
  // now applied across the merged set.
  candidates.sort((a, b) => candidateGlobalOrdinal(b) - candidateGlobalOrdinal(a));

  return candidates.slice(0, limit);
}
