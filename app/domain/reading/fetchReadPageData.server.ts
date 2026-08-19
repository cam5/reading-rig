import type { PrismaClient } from "../../../generated/prisma/client";
import { assertWorkReadableBy } from "./assertWorkReadableBy.server";
import {
  DEFAULT_CONTENT_BYTE_BUDGET,
  selectInitialContentWindow,
} from "./contentWindow";
import { fetchContentWindow } from "./fetchContentWindow.server";
import { computeReadingProgress } from "./readingProgress";
import { resolveSectionRef } from "./sectionNavigation";

/**
 * read.tsx's page loader and api.v1.read.tsx's JSON loader share this —
 * the work's outline, its structural (content-free) paragraph list, an
 * initial byte-budgeted content window centered on `sectionIdParam` (or
 * the work's start), the reader's bookmark, and the progress/time-left
 * derived from it. See read.tsx's own loader comments (before this was
 * extracted) for why each piece is shaped the way it is — `select` over
 * `include` on Work to keep the cover image's bytes out of this payload,
 * the structural/content paragraph split to keep the byte-budgeted window
 * separate from the whole-work ordinal/wordCount list virtualization
 * needs, etc.
 *
 * Deliberately doesn't fire the `work_opened` analytics event itself —
 * that event's shape currently assumes one page view per call, and
 * whether/how a non-browser client's "open a work" should be tracked is
 * an open question (see #192), not one this extraction should silently
 * decide. Callers that want it (read.tsx's loader) still fire it
 * themselves, same as before.
 */
export async function fetchReadPageData(
  db: Pick<
    PrismaClient,
    | "work"
    | "paragraph"
    | "readingPosition"
    | "highlightSpan"
    | "entry"
    | "footnote"
  >,
  userId: string,
  workId: string,
  sectionIdParam: string | null,
) {
  // "May this user load this Work" — the same ownership seam
  // assertParagraphsAnnotatableBy.server.ts checks for mutations in
  // read.tsx's action, now checked through the same helper rather than a
  // second hand-rolled ownerId filter.
  await assertWorkReadableBy(db, userId, workId);

  const work = await db.work.findFirstOrThrow({
    where: { id: workId },
    select: {
      id: true,
      title: true,
      author: true,
      chapters: {
        orderBy: { ordinal: "asc" },
        include: {
          sections: {
            orderBy: { ordinal: "asc" },
            select: { id: true, label: true, ordinal: true },
          },
        },
      },
    },
  });

  // ?section=<id> only picks where the reader *lands* on this load — the
  // whole work still renders as one continuous column (#51). Absent (or
  // pointing at a section that isn't actually part of this work) falls
  // back to the first chapter's first section.
  const initialSection = resolveSectionRef(work.chapters, sectionIdParam);

  // The whole work's *structural* facts — id/ordinals/wordCount, no
  // html/text — for every paragraph regardless of book length. Drives
  // virtualization (rows/heights) and the bookmark/progress math below,
  // neither of which ever needed paragraph content; only the `content`
  // window fetched further down does. Ordered by globalOrdinal — already
  // the whole-work reading order, so no per-section re-sort is needed to
  // lay rows out end to end.
  const structuralParagraphs = await db.paragraph.findMany({
    where: { section: { chapter: { workId: work.id } } },
    orderBy: { globalOrdinal: "asc" },
    select: {
      id: true,
      ordinal: true,
      globalOrdinal: true,
      wordCount: true,
      section: {
        select: {
          id: true,
          ordinal: true,
          chapter: { select: { id: true, ordinal: true } },
        },
      },
    },
  });

  // Where the content window centers: the landing section's first
  // paragraph, or globalOrdinal 1 when no section was requested (or it
  // didn't resolve to one — see resolveSectionRef above) — "defaults to
  // the start" falls out of the same lookup, not a separate branch.
  const anchorGlobalOrdinal =
    (initialSection &&
      structuralParagraphs.find(
        (p) => p.section.id === initialSection.sectionId && p.ordinal === 1,
      )?.globalOrdinal) ??
    1;

  // Only a byte-budgeted slice of paragraphs actually gets html/text/
  // highlightSpans/entries up front — this is the payload Lighthouse's
  // document-size budget was blowing past at whole-book scale (see
  // lighthouserc.cjs). api.v1.read-content.tsx (via useContentWindow client-side,
  // or a client's own equivalent) fetches more as the reader's window
  // approaches either edge of what's loaded here.
  const contentRange = selectInitialContentWindow(
    structuralParagraphs,
    anchorGlobalOrdinal,
    DEFAULT_CONTENT_BYTE_BUDGET,
    // The column renders forward from the anchor, so paragraphs behind it
    // have nothing to render into until the reader asks for them.
    true,
  );
  const contentParagraphs = contentRange
    ? await fetchContentWindow(db, work.id, contentRange)
    : [];

  const position = await db.readingPosition.findUnique({
    where: { userId_workId: { userId, workId: work.id } },
    include: { paragraph: { select: { globalOrdinal: true } } },
  });
  // No position yet means nothing has been read: globalOrdinal 0 is
  // "before the first paragraph", which both isWithinBookmark and the
  // progress/time-left math below treat correctly as the starting line.
  const bookmarkGlobalOrdinal = position?.paragraph.globalOrdinal ?? 0;

  // totalParagraphs/remainingWords need every paragraph's wordCount, not
  // its text — the structural tier carries that already (precomputed at
  // ingest, see Paragraph.wordCount's schema comment), so this never
  // needs the content window's html/text in memory to work out "how much
  // is left".
  const totalParagraphs = structuralParagraphs.length;
  const { progressPercent, timeLeft } = computeReadingProgress(
    structuralParagraphs.map((p) => ({
      globalOrdinal: p.globalOrdinal,
      wordCount: p.wordCount,
    })),
    totalParagraphs,
    bookmarkGlobalOrdinal,
  );

  return {
    work,
    structuralParagraphs,
    content: contentRange
      ? {
          paragraphs: contentParagraphs,
          minGlobalOrdinal: contentRange.minGlobalOrdinal,
          maxGlobalOrdinal: contentRange.maxGlobalOrdinal,
        }
      : {
          paragraphs: contentParagraphs,
          minGlobalOrdinal: 0,
          maxGlobalOrdinal: 0,
        },
    initialSection,
    bookmarkGlobalOrdinal,
    progressPercent,
    timeLeft,
    // Handed back so a caller that wants to track `work_opened` (read.tsx's
    // loader) has everything the event needs without re-deriving it, rather
    // than approximating it from the content window afterward.
    anchorGlobalOrdinal,
    isResume: position !== null,
  };
}
