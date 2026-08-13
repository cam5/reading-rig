import type { PrismaClient } from "../../../generated/prisma/client";
import type { OrdinalRange } from "./scrollPosition";

type Db = Pick<PrismaClient, "paragraph" | "highlightSpan" | "entry">;

/**
 * The content tier for one ordinal range of one work: paragraph
 * html/text plus the highlightSpans/entries that reach them — the shared
 * query shape `read.tsx`'s loader (initial window) and `read-content.tsx`
 * (every later fetch as the reader scrolls) both need, kept in one place
 * so the two don't drift.
 *
 * `globalOrdinal` is only monotonic *within* a work (parseEpub.ts resets
 * it to 1 per work), not a global key — every query here is scoped by
 * `workId` through the same `section.chapter.workId` join path the
 * original whole-work query used, not by ordinal range alone. Callers
 * are responsible for the ownership check (this function doesn't know
 * who's asking) — same seam split as assertParagraphsAnnotatableBy vs.
 * the queries it gates.
 *
 * A highlight can straddle the requested range's edge — its spans reach
 * a paragraph outside `range` that this fetch wasn't asked for, and
 * deriveHighlights (marginalia.ts) needs that paragraph's `text` to
 * reconstruct the highlight's full string, not a truncated slice. Rather
 * than let that render wrong, this over-fetches: any paragraph reached by
 * a highlight that touches the requested range comes along too, however
 * far outside `range` it falls. Bounded by how many paragraphs a
 * highlight's own spans reach (always small in practice), nowhere near
 * the paragraph-count scale that made an `id IN (...)` query unsafe for
 * the *original* whole-book fetch (see read.tsx's own P2029 comment).
 */
export async function fetchContentWindow(
  db: Db,
  workId: string,
  range: OrdinalRange,
) {
  const baseParagraphs = await db.paragraph.findMany({
    where: {
      globalOrdinal: {
        gte: range.minGlobalOrdinal,
        lte: range.maxGlobalOrdinal,
      },
      section: { chapter: { workId } },
    },
    orderBy: { globalOrdinal: "asc" },
  });
  const baseIds = baseParagraphs.map((p) => p.id);

  const baseSpans =
    baseIds.length > 0
      ? await db.highlightSpan.findMany({
          where: { paragraphId: { in: baseIds } },
        })
      : [];
  const touchedHighlightIds = [...new Set(baseSpans.map((s) => s.highlightId))];

  // Every span of every highlight that touches the requested range — a
  // superset of baseSpans, refetched with the `highlight` relation
  // ReadingParagraph needs (highlightClassName reads `.highlight.role`).
  const allSpans =
    touchedHighlightIds.length > 0
      ? await db.highlightSpan.findMany({
          where: { highlightId: { in: touchedHighlightIds } },
          include: { highlight: true },
        })
      : [];

  const baseIdSet = new Set(baseIds);
  const extraIds = [
    ...new Set(
      allSpans.map((s) => s.paragraphId).filter((id) => !baseIdSet.has(id)),
    ),
  ];
  const extraParagraphs =
    extraIds.length > 0
      ? await db.paragraph.findMany({ where: { id: { in: extraIds } } })
      : [];

  const allParagraphs = [...baseParagraphs, ...extraParagraphs].sort(
    (a, b) => a.globalOrdinal - b.globalOrdinal,
  );
  const allIds = allParagraphs.map((p) => p.id);

  // Entries anchor to exactly one paragraph — no cross-boundary problem
  // like highlights have, just entries for whichever paragraphs (base or
  // extra) ended up in this response.
  const entries =
    allIds.length > 0
      ? await db.entry.findMany({
          where: { anchorParagraphId: { in: allIds } },
          orderBy: { createdAt: "asc" },
        })
      : [];

  const spansByParagraphId = new Map<string, typeof allSpans>();
  for (const span of allSpans) {
    const list = spansByParagraphId.get(span.paragraphId) ?? [];
    list.push(span);
    spansByParagraphId.set(span.paragraphId, list);
  }
  const entriesByParagraphId = new Map<string, typeof entries>();
  for (const entry of entries) {
    const list = entriesByParagraphId.get(entry.anchorParagraphId) ?? [];
    list.push(entry);
    entriesByParagraphId.set(entry.anchorParagraphId, list);
  }

  return allParagraphs.map((paragraph) => ({
    ...paragraph,
    highlightSpans: spansByParagraphId.get(paragraph.id) ?? [],
    entries: entriesByParagraphId.get(paragraph.id) ?? [],
  }));
}

export type ContentWindowParagraph = Awaited<
  ReturnType<typeof fetchContentWindow>
>[number];
