import type { PrismaClient } from "../../../generated/prisma/client";
import { formatLocator } from "../../domain/locator";
import { isWithinBookmark } from "../../domain/reading/bookmark";

/**
 * Shared shape every reading-tool handler in this directory returns a
 * passage as. Plain data — no Prisma payload types, no SDK types — because
 * nothing in `app/rig/tools/*.ts` is supposed to know which transport (the
 * agent's custom-tool loop today, an MCP façade in M5) called it.
 */
export type Passage = {
  paragraphId: string;
  workId: string;
  workTitle: string;
  chapterOrdinal: number;
  sectionOrdinal: number;
  ordinal: number;
  globalOrdinal: number;
  text: string;
  html: string;
  /** e.g. "§4 ¶3" — derived via domain/locator, never stored. */
  locator: string;
};

/** The include chain every handler here needs to derive a Passage: enough
 * of section -> chapter -> work to build a locator and confirm ownership. */
export const paragraphInclude = {
  section: { include: { chapter: { include: { work: true } } } },
} as const;

type ParagraphWithContext = {
  id: string;
  text: string;
  html: string;
  ordinal: number;
  globalOrdinal: number;
  section: {
    ordinal: number;
    chapter: {
      ordinal: number;
      work: { id: string; title: string };
    };
  };
};

export function toPassage(paragraph: ParagraphWithContext): Passage {
  const { section } = paragraph;
  const { chapter } = section;
  const { work } = chapter;
  return {
    paragraphId: paragraph.id,
    workId: work.id,
    workTitle: work.title,
    chapterOrdinal: chapter.ordinal,
    sectionOrdinal: section.ordinal,
    ordinal: paragraph.ordinal,
    globalOrdinal: paragraph.globalOrdinal,
    text: paragraph.text,
    html: paragraph.html,
    locator: formatLocator({
      sectionLabel: String(section.ordinal),
      paragraphOrdinal: paragraph.ordinal,
    }),
  };
}

/**
 * A note/annotation match for the composer's unified search (#117 follow-up)
 * — same shape-of-purpose as Passage, but for an Entry rather than a
 * Paragraph. Carries globalOrdinal (the anchor paragraph's, not the entry's
 * own) so a caller can rank it against Passage results by the same
 * closest-to-bookmark rule without a second lookup.
 */
export type NoteMatch = {
  entryId: string;
  workId: string;
  workTitle: string;
  body: string;
  anchorParagraphId: string;
  /** e.g. "§4 ¶3" — the anchor paragraph's locator. */
  locator: string;
  globalOrdinal: number;
};

/** The include chain toNoteMatch needs: enough of anchorParagraph's own
 * chain to build a locator and workTitle, same shape as paragraphInclude
 * but one hop deeper (through Entry.anchorParagraph first). */
export const entryInclude = {
  anchorParagraph: { include: paragraphInclude },
} as const;

type EntryWithAnchor = {
  id: string;
  body: string;
  anchorParagraph: ParagraphWithContext;
};

export function toNoteMatch(entry: EntryWithAnchor): NoteMatch {
  const paragraph = entry.anchorParagraph;
  const { section } = paragraph;
  const { chapter } = section;
  const { work } = chapter;
  return {
    entryId: entry.id,
    workId: work.id,
    workTitle: work.title,
    body: entry.body,
    anchorParagraphId: paragraph.id,
    locator: formatLocator({
      sectionLabel: String(section.ordinal),
      paragraphOrdinal: paragraph.ordinal,
    }),
    globalOrdinal: paragraph.globalOrdinal,
  };
}

/**
 * The bookmark a work's owner has reached, as a globalOrdinal — 0 (before
 * the first paragraph) if nothing's been read yet. Same convention
 * read.tsx's loader already uses, so a tool handler and the reader route
 * agree on what "nothing read yet" means.
 */
export async function fetchBookmarkGlobalOrdinal(
  db: PrismaClient,
  userId: string,
  workId: string,
): Promise<number> {
  const position = await db.readingPosition.findUnique({
    where: { userId_workId: { userId, workId } },
    include: { paragraph: { select: { globalOrdinal: true } } },
  });
  return position?.paragraph.globalOrdinal ?? 0;
}

/**
 * Fetches a paragraph this user owns, with enough context to derive a
 * locator — null if it doesn't exist or belongs to someone else's work.
 * Deliberately does NOT apply the bookmark boundary itself: a caller needs
 * to know which work the paragraph belongs to before it can look up that
 * work's bookmark, so the two checks can't collapse into one query the way
 * search_shelf's can (it's handed workId + bookmarkGlobalOrdinal already).
 */
export async function fetchOwnedParagraph(
  db: PrismaClient,
  userId: string,
  paragraphId: string,
) {
  return db.paragraph.findFirst({
    where: {
      id: paragraphId,
      section: { chapter: { work: { ownerId: userId } } },
    },
    include: paragraphInclude,
  });
}

export { isWithinBookmark };
