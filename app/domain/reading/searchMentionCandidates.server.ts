import type { PrismaClient } from "../../../generated/prisma/client";
import { entryInclude, paragraphInclude, toNoteMatch, toPassage, type NoteMatch, type Passage } from "../../rig/tools/shared";

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
 * Candidates for the composer's "@" autocomplete — same substring-match shape
 * as search_shelf, but for a live-as-you-type popup rather than an agent
 * tool call: capped at `limit` and ordered closest-to-bookmark first instead
 * of reading order, so the paragraphs (and, now, notes) a reader is most
 * likely to be talking about surface at the top of a short list.
 *
 * Deliberately a fork of search_shelf, not a shared mode flag on it — that
 * handler's asc/no-limit ordering reads as intentional for the agent's own
 * use (reading order, not relevance), and this endpoint fires on every
 * keystroke rather than once per tool call, so it shouldn't risk changing
 * that behavior by accident.
 *
 * Unlike search_shelf (and getPassage/getSurrounding), this does NOT apply
 * `isWithinBookmark`/`bookmarkWhereClause` — see bookmark.ts's own comment:
 * that boundary exists so the *Rig* can't surface an unrequested spoiler in
 * its own retrieval. A mention is the reader explicitly pointing at
 * something already on their own screen (see #117's onScreenExcerpt, never
 * bookmark-gated either); it doesn't need protecting from itself. Per-work
 * strictness over how far "on screen" is allowed to reach (#99) belongs as
 * a real setting later, not a hardcoded cutoff baked in here first.
 *
 * Paragraphs and notes are each fetched as two independent top-`limit`
 * queries — one on either side of the bookmark, since neither Prisma nor
 * this app's SQLite backing gives an easy `ORDER BY ABS(...)` — then merged
 * and re-cut to `limit` by distance from the bookmark. Ordering each side by
 * globalOrdinal (desc behind, asc ahead) is exactly "closest first" for that
 * side, so a candidate landing in the true global top-`limit` by distance is
 * guaranteed to be within its own side-and-type's top-`limit` too: nothing
 * gets missed by not doing this as one combined query (which Prisma has no
 * way to express across two tables anyway).
 */
export async function searchMentionCandidates(
  db: PrismaClient,
  { userId, workId, query, bookmarkGlobalOrdinal, limit = MENTION_SUGGESTION_LIMIT }: SearchMentionCandidatesInput,
): Promise<MentionCandidate[]> {
  const trimmed = query.trim();
  const workScope = { section: { chapter: { workId, work: { ownerId: userId } } } };

  const [paragraphsBehind, paragraphsAhead, entriesBehind, entriesAhead] = await Promise.all([
    db.paragraph.findMany({
      where: { ...workScope, text: { contains: trimmed }, globalOrdinal: { lte: bookmarkGlobalOrdinal } },
      orderBy: { globalOrdinal: "desc" },
      take: limit,
      include: paragraphInclude,
    }),
    db.paragraph.findMany({
      where: { ...workScope, text: { contains: trimmed }, globalOrdinal: { gt: bookmarkGlobalOrdinal } },
      orderBy: { globalOrdinal: "asc" },
      take: limit,
      include: paragraphInclude,
    }),
    db.entry.findMany({
      where: { body: { contains: trimmed }, anchorParagraph: { ...workScope, globalOrdinal: { lte: bookmarkGlobalOrdinal } } },
      orderBy: { anchorParagraph: { globalOrdinal: "desc" } },
      take: limit,
      include: entryInclude,
    }),
    db.entry.findMany({
      where: { body: { contains: trimmed }, anchorParagraph: { ...workScope, globalOrdinal: { gt: bookmarkGlobalOrdinal } } },
      orderBy: { anchorParagraph: { globalOrdinal: "asc" } },
      take: limit,
      include: entryInclude,
    }),
  ]);

  const candidates: MentionCandidate[] = [
    ...paragraphsBehind.map((p) => ({ kind: "paragraph" as const, passage: toPassage(p) })),
    ...paragraphsAhead.map((p) => ({ kind: "paragraph" as const, passage: toPassage(p) })),
    ...entriesBehind.map((e) => ({ kind: "note" as const, note: toNoteMatch(e) })),
    ...entriesAhead.map((e) => ({ kind: "note" as const, note: toNoteMatch(e) })),
  ];

  candidates.sort(
    (a, b) => Math.abs(candidateGlobalOrdinal(a) - bookmarkGlobalOrdinal) - Math.abs(candidateGlobalOrdinal(b) - bookmarkGlobalOrdinal),
  );

  return candidates.slice(0, limit);
}
