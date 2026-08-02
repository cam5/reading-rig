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
    locator: formatLocator({ sectionLabel: String(section.ordinal), paragraphOrdinal: paragraph.ordinal }),
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
export async function fetchOwnedParagraph(db: PrismaClient, userId: string, paragraphId: string) {
  return db.paragraph.findFirst({
    where: { id: paragraphId, section: { chapter: { work: { ownerId: userId } } } },
    include: paragraphInclude,
  });
}

export { isWithinBookmark };
