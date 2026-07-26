import type { EntryOrigin, Posture, PrismaClient } from "../../../generated/prisma/client";
import { formatLocator } from "../../domain/locator";

export type ListMyNotesInput = {
  userId: string;
  /** Scopes to one work; omitted, this is commonplace.tsx's "whole shelf"
   * query — every Entry that anchors into a paragraph that traces back to
   * a Work this user owns, unfiltered by which one. */
  workId?: string;
};

export type NoteSummary = {
  entryId: string;
  origin: EntryOrigin;
  posture?: Posture;
  body: string;
  workId: string;
  workTitle: string;
  locator: string;
  createdAt: Date;
};

/**
 * Notes already kept in the margin — read-only, and deliberately so: this
 * is how the agent sees what's already been written, never how anything
 * gets written. Save-to-margin (#21) is the only path that creates an
 * Entry; nothing here does.
 *
 * Not bookmark-bounded like search_shelf/get_passage/get_surrounding are.
 * An Entry only ever exists because the reader (or, later, the reader
 * saving a Rig answer) already had its anchor paragraph in view, so it
 * can't point past a bookmark that hasn't been set past it — the same
 * assumption commonplace.tsx's loader makes by not bookmark-filtering its
 * own "whole shelf" query.
 */
export async function listMyNotes(db: PrismaClient, { userId, workId }: ListMyNotesInput): Promise<NoteSummary[]> {
  const entries = await db.entry.findMany({
    where: {
      anchorParagraph: {
        section: { chapter: { work: { ownerId: userId, ...(workId ? { id: workId } : {}) } } },
      },
    },
    orderBy: { createdAt: "desc" },
    include: {
      anchorParagraph: {
        include: { section: { include: { chapter: { include: { work: true } } } } },
      },
    },
  });

  return entries.map((entry) => {
    const paragraph = entry.anchorParagraph;
    const section = paragraph.section;
    const chapter = section.chapter;
    const work = chapter.work;
    return {
      entryId: entry.id,
      origin: entry.origin,
      posture: entry.posture ?? undefined,
      body: entry.body,
      workId: work.id,
      workTitle: work.title,
      locator: formatLocator({ sectionLabel: String(section.ordinal), paragraphOrdinal: paragraph.ordinal }),
      createdAt: entry.createdAt,
    };
  });
}
