import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "~/db.server";
import { requireUser } from "~/user.server";
import { ChapterSectionDivider } from "~/components/ChapterSectionDivider";
import { PageStack } from "~/components/PageStack";
import { PostureRail } from "~/components/PostureRail";
import { ReaderHeader } from "~/components/ReaderHeader";
import { ReadingParagraph } from "~/components/ReadingParagraph";
import { SelectionHighlighter } from "~/components/SelectionHighlighter";
import { MarginaliaSidebar } from "~/components/MarginaliaSidebar";
import { useBookmarkTracker } from "~/components/useBookmarkTracker";
import { useVirtualizedRows } from "~/components/useVirtualizedRows";
import { highlightClassName } from "~/domain/paragraph/highlightRole";
import { overlapsExisting, type SpanRange } from "~/domain/paragraph/highlightOverlap";
import { assertParagraphsAnnotatableBy } from "~/domain/paragraph/assertParagraphsAnnotatableBy.server";
import { deriveEntries, deriveHighlights } from "~/domain/paragraph/marginalia";
import { estimateParagraphHeightPx } from "~/domain/reading/paragraphHeightEstimate";
import { countWords } from "~/domain/reading/readingTime";
import { computeReadingProgress } from "~/domain/reading/readingProgress";
import type { OrdinalRange } from "~/domain/reading/scrollPosition";
import {
  nextSectionRef,
  previousSectionRef,
  resolveSectionRef,
  type SectionRef,
} from "~/domain/reading/sectionNavigation";
import type { Route } from "./+types/read";

// A rough guess used only until useVirtualizedRows' ResizeObserver reports
// each divider's real height — just enough that the very first paint
// windows correctly around the initial scroll position instead of
// mounting the whole book. A divider is one line plus its mb-6, and low
// variance row to row, so a flat constant is fine here. Paragraphs are
// far more variable in length, so their own guess
// (estimateParagraphHeightPx, in ~/domain/reading/paragraphHeightEstimate)
// is keyed off each paragraph's actual text instead of one flat number.
const ESTIMATED_DIVIDER_HEIGHT_PX = 64;

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `${loaderData.work.title} — Reading Rig` : "Reading Rig" }];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const user = await requireUser();
  const workId = params["*"];
  const sectionIdParam = new URL(request.url).searchParams.get("section");

  // Chapter/section outline only here — cheap, no paragraph text. Used to
  // resolve ?section= below and, client-side, to compute SectionNav's
  // prev/next targets as the reader jumps around (see the component).
  //
  // "May this user load this Work" — today exactly "the user owns it"
  // (ownerId), the same annotatable-access seam
  // assertParagraphsAnnotatableBy.server.ts checks for mutations below.
  const work = await db.work.findFirstOrThrow({
    where: { id: workId, ownerId: user.id },
    include: {
      chapters: {
        orderBy: { ordinal: "asc" },
        include: { sections: { orderBy: { ordinal: "asc" }, select: { id: true, label: true, ordinal: true } } },
      },
    },
  });

  // ?section=<id> only picks where the reader *lands* on this load — the
  // whole work still renders as one continuous column below (#51). Absent
  // (or pointing at a section that isn't actually part of this work) falls
  // back to the first chapter's first section.
  const initialSection = resolveSectionRef(work.chapters, sectionIdParam);

  // The whole work's paragraphs, not one section's: the reading pane is a
  // single continuous scroll now, so every chapter/section has to be in
  // the loader's data even though only a window of it is ever mounted as
  // real DOM (useVirtualizedRows, client-side). Ordered by globalOrdinal —
  // already the whole-work reading order, so no per-section re-sort is
  // needed to lay paragraphs out end to end.
  //
  // highlightSpans/entries are fetched as their own queries, joined back
  // to the same workId path, rather than a nested Prisma `include` off
  // paragraph — a nested include resolves as a second query filtered by
  // `paragraphId IN (<every paragraph's id>)`, and at ~2000 paragraphs
  // (a full novel) that blows past SQLite's bound-parameter limit outright
  // (P2029). Filtering by the join path instead of an id list sidesteps
  // the limit regardless of how many paragraphs the work has.
  const [paragraphRows, highlightSpans, entries] = await Promise.all([
    db.paragraph.findMany({
      where: { section: { chapter: { workId: work.id } } },
      orderBy: { globalOrdinal: "asc" },
      include: { section: { select: { id: true, ordinal: true, chapter: { select: { id: true, ordinal: true } } } } },
    }),
    db.highlightSpan.findMany({
      where: { paragraph: { section: { chapter: { workId: work.id } } } },
      include: { highlight: true },
    }),
    db.entry.findMany({
      where: { anchorParagraph: { section: { chapter: { workId: work.id } } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const highlightSpansByParagraphId = new Map<string, typeof highlightSpans>();
  for (const span of highlightSpans) {
    const list = highlightSpansByParagraphId.get(span.paragraphId) ?? [];
    list.push(span);
    highlightSpansByParagraphId.set(span.paragraphId, list);
  }
  const entriesByParagraphId = new Map<string, typeof entries>();
  for (const entry of entries) {
    const list = entriesByParagraphId.get(entry.anchorParagraphId) ?? [];
    list.push(entry);
    entriesByParagraphId.set(entry.anchorParagraphId, list);
  }
  const paragraphs = paragraphRows.map((paragraph) => ({
    ...paragraph,
    highlightSpans: highlightSpansByParagraphId.get(paragraph.id) ?? [],
    entries: entriesByParagraphId.get(paragraph.id) ?? [],
  }));

  const position = await db.readingPosition.findUnique({
    where: { userId_workId: { userId: user.id, workId: work.id } },
    include: { paragraph: { select: { globalOrdinal: true } } },
  });
  // No position yet means nothing has been read: globalOrdinal 0 is
  // "before the first paragraph", which both isWithinBookmark and the
  // progress/time-left math below treat correctly as the starting line.
  const bookmarkGlobalOrdinal = position?.paragraph.globalOrdinal ?? 0;

  // totalParagraphs/remainingWords used to be their own queries against
  // paragraphs this loader otherwise never touched (one section's worth
  // wasn't the whole work). Now that every paragraph is already loaded
  // above, deriving both from that same array in memory is strictly
  // cheaper than two more round trips — the *values* mean exactly what
  // they always did (progressPercent is still bookmarkGlobalOrdinal over
  // the whole work's paragraph count), only where they're computed changed.
  //
  // computeReadingProgress (app/domain/reading/readingProgress.ts) is the
  // one place that math lives — the client re-runs the exact same function
  // after each scroll-settle debounce (#54, phase 3 of #51), against the
  // paragraphs this same loader already put in memory, rather than a
  // second implementation that could drift from this one.
  const totalParagraphs = paragraphs.length;
  const { progressPercent, timeLeft } = computeReadingProgress(
    paragraphs.map((p) => ({ globalOrdinal: p.globalOrdinal, wordCount: countWords(p.text) })),
    totalParagraphs,
    bookmarkGlobalOrdinal,
  );

  return {
    work,
    paragraphs,
    initialSection,
    bookmarkGlobalOrdinal,
    progressPercent,
    timeLeft,
  };
}

function parseSpans(formData: FormData): SpanRange[] {
  return JSON.parse(String(formData.get("spans"))) as SpanRange[];
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser();
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "highlight") {
    const spans = parseSpans(formData);

    // Checked for every paragraph a spanning highlight touches, not just one.
    await assertParagraphsAnnotatableBy(db, user.id, spans.map((s) => s.paragraphId));

    // mergeHighlights.ts refuses to render two highlights over the same
    // character rather than silently attributing it to whichever comes
    // first — reject the overlap here, before it's ever persisted, instead
    // of only discovering it later, mid-render, for every reader of the
    // paragraph.
    const existingSpans = await db.highlightSpan.findMany({
      where: { paragraphId: { in: spans.map((s) => s.paragraphId) } },
      select: { paragraphId: true, startOffset: true, endOffset: true },
    });
    const overlaps = overlapsExisting(
      spans,
      existingSpans.map((s) => ({ paragraphId: s.paragraphId, start: s.startOffset, end: s.endOffset })),
    );
    if (overlaps) throw new Response("This selection overlaps an existing highlight", { status: 409 });

    // Every highlight made through this UI is role: hand — there's no Rig
    // yet to make the other kind (that's M3's). One Highlight, one
    // HighlightSpan per paragraph it reaches.
    await db.highlight.create({
      data: {
        userId: user.id,
        role: "hand",
        spans: {
          create: spans.map((s) => ({ paragraphId: s.paragraphId, startOffset: s.start, endOffset: s.end })),
        },
      },
    });
    return { ok: true };
  }

  if (intent === "highlight-note") {
    // A note about a *fresh* spanning selection — there's no Highlight
    // yet for it to reference (unlike the "note" branch below, which
    // attaches to one that already exists), so this creates both
    // together in one transaction: cancelling the note composer before
    // this ever fires leaves nothing behind, and there's no window where
    // the Highlight exists without the note that was actually the point.
    const spans = parseSpans(formData);
    await assertParagraphsAnnotatableBy(db, user.id, spans.map((s) => s.paragraphId));

    const body = String(formData.get("body") ?? "").trim();
    if (!body) throw new Response("A note needs a body", { status: 400 });

    await db.$transaction(async (tx) => {
      const highlight = await tx.highlight.create({
        data: {
          userId: user.id,
          role: "hand",
          spans: {
            create: spans.map((s) => ({ paragraphId: s.paragraphId, startOffset: s.start, endOffset: s.end })),
          },
        },
      });
      await tx.entry.create({
        data: {
          userId: user.id,
          origin: "hand",
          body,
          // The first paragraph the selection reaches — same "coarser
          // than Highlight, on purpose" anchor every Entry uses (see the
          // model comment in schema.prisma). `spans` arrives in document
          // order from resolveSelectionSpans, so spans[0] is it.
          anchorParagraphId: spans[0].paragraphId,
          highlightId: highlight.id,
          contextSnapshot: { excerpt: String(formData.get("excerpt") ?? "") },
        },
      });
    });
    return { ok: true };
  }

  if (intent === "note") {
    const paragraphId = String(formData.get("paragraphId"));
    await assertParagraphsAnnotatableBy(db, user.id, [paragraphId]);

    // A note can be about a Highlight instead of standing alone. Access
    // rides on the paragraph check above: the highlight has to actually
    // reach the paragraph this note anchors to, so there's no separate
    // work/ownerId lookup to duplicate here.
    const highlightIdRaw = formData.get("highlightId");
    let highlightId: string | null = null;
    if (highlightIdRaw) {
      const span = await db.highlightSpan.findFirst({
        where: { highlightId: String(highlightIdRaw), paragraphId },
      });
      if (!span) throw new Response("Not found", { status: 404 });
      highlightId = String(highlightIdRaw);
    }

    const body = String(formData.get("body") ?? "").trim();
    if (!body) throw new Response("A note needs a body", { status: 400 });
    // contextSnapshot's only field today is the excerpt this was saved
    // against — a hand entry's whole "provenance" until M3 gives the Rig
    // richer context (which passages and prior entries were in view) to
    // capture in the same field.
    await db.entry.create({
      data: {
        userId: user.id,
        origin: "hand",
        body,
        anchorParagraphId: paragraphId,
        highlightId,
        contextSnapshot: { excerpt: String(formData.get("excerpt") ?? "") },
      },
    });
    return { ok: true };
  }

  if (intent === "bookmark") {
    const paragraphId = String(formData.get("paragraphId"));

    // Same annotatable-access boundary the loader enforces: a paragraph
    // only exists for this action if it resolves back to a Work this user
    // may annotate.
    const paragraph = await db.paragraph.findFirst({
      where: { id: paragraphId, section: { chapter: { work: { ownerId: user.id } } } },
      select: { section: { select: { chapter: { select: { workId: true } } } } },
    });
    if (!paragraph) throw new Response("Not found", { status: 404 });

    const workId = paragraph.section.chapter.workId;
    await db.readingPosition.upsert({
      where: { userId_workId: { userId: user.id, workId } },
      update: { paragraphId },
      create: { userId: user.id, workId, paragraphId },
    });
    return { ok: true };
  }

  throw new Response("Unknown intent", { status: 400 });
}

// One row per thing that actually occupies vertical space in the
// continuous reading column — a paragraph, or a chapter/section divider
// immediately before that section's first paragraph. useVirtualizedRows
// mounts/unmounts by row, not by paragraph alone, so a divider has to be
// a row in its own right or its height would never be accounted for in
// the spacer math.
type LoaderParagraph = Route.ComponentProps["loaderData"]["paragraphs"][number];
type ReadingRow =
  | { type: "divider"; id: string; chapterOrdinal: number; sectionOrdinal: number }
  | { type: "paragraph"; id: string; paragraph: LoaderParagraph };

export default function Read({ loaderData }: Route.ComponentProps) {
  const {
    work,
    paragraphs,
    initialSection,
    bookmarkGlobalOrdinal,
    progressPercent: initialProgressPercent,
    timeLeft: initialTimeLeft,
  } = loaderData;

  // A paragraph's own ordinal-within-its-section is 1 exactly for the
  // first paragraph of a section — cheaper than re-deriving section
  // boundaries from work.chapters, and it's already loaded per paragraph.
  const rows = useMemo<ReadingRow[]>(() => {
    const result: ReadingRow[] = [];
    for (const paragraph of paragraphs) {
      if (paragraph.ordinal === 1) {
        result.push({
          type: "divider",
          id: `divider:${paragraph.section.id}`,
          chapterOrdinal: paragraph.section.chapter.ordinal,
          sectionOrdinal: paragraph.section.ordinal,
        });
      }
      result.push({ type: "paragraph", id: paragraph.id, paragraph });
    }
    return result;
  }, [paragraphs]);

  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const initialHeights = useMemo(
    () =>
      rows.map((row) =>
        row.type === "divider" ? ESTIMATED_DIVIDER_HEIGHT_PX : estimateParagraphHeightPx(row.paragraph.text),
      ),
    [rows],
  );

  const readingColumnRef = useRef<HTMLDivElement>(null);
  const { startIndex, endIndex, topSpacerHeight, bottomSpacerHeight, registerRowRef, scrollToRow } =
    useVirtualizedRows({ containerRef: readingColumnRef, rowIds, initialHeights });

  // SectionNav's own notion of "where am I" — it moves both when
  // SectionNav is clicked (jumpToSection, below) and, now, whenever the
  // scroll-settle debounce below resolves to a different section (#54);
  // either way the URL is kept in sync with whichever one moved it last.
  const [currentSectionRef, setCurrentSectionRef] = useState<SectionRef | null>(initialSection);
  const previousSection = currentSectionRef ? previousSectionRef(work.chapters, currentSectionRef) : null;
  const nextSection = currentSectionRef ? nextSectionRef(work.chapters, currentSectionRef) : null;

  // Per paragraph: everything useBookmarkTracker needs to resolve "current
  // section" and recompute progress/timeLeft client-side, without a
  // second fetch — the whole work's paragraphs (text included) are
  // already loaded via loaderData (phase 1, #53); only the word count and
  // section reference need deriving from that once here.
  const paragraphInfoById = useMemo(
    () =>
      Object.fromEntries(
        paragraphs.map((p) => [
          p.id,
          {
            globalOrdinal: p.globalOrdinal,
            wordCount: countWords(p.text),
            section: { chapterId: p.section.chapter.id, sectionId: p.section.id },
          },
        ]),
      ),
    [paragraphs],
  );

  const { progressPercent, timeLeft, visibleOrdinalRange } = useBookmarkTracker({
    containerRef: readingColumnRef,
    workId: work.id,
    paragraphs: paragraphInfoById,
    totalParagraphs: paragraphs.length,
    initialGlobalOrdinal: bookmarkGlobalOrdinal,
    initialProgressPercent,
    initialTimeLeft,
    onSectionChange: setCurrentSectionRef,
  });

  // Before the first scroll-settle debounce fires (#55, phase 4 of #51),
  // there's no measured virtualized window yet to scope marginalia to —
  // fall back to the section the reader landed on, the same "one section
  // for the whole visit" scoping marginalia used before phase 1 (#53)
  // loaded the whole work's entries/highlights up front. The very first
  // scroll settle replaces this with the real, viewport-following range
  // from useBookmarkTracker.
  const initialSectionOrdinalRange = useMemo<OrdinalRange | null>(() => {
    if (!initialSection) return null;
    const ordinals = paragraphs
      .filter((p) => p.section.id === initialSection.sectionId)
      .map((p) => p.globalOrdinal);
    if (ordinals.length === 0) return null;
    return { minGlobalOrdinal: Math.min(...ordinals), maxGlobalOrdinal: Math.max(...ordinals) };
  }, [paragraphs, initialSection]);

  const marginaliaOrdinalRange = visibleOrdinalRange ?? initialSectionOrdinalRange;

  function jumpToSection(target: SectionRef) {
    scrollToRow(`divider:${target.sectionId}`);
    setCurrentSectionRef(target);
    // A plain history update, not a react-router navigation: the whole
    // work's paragraphs are already loaded client-side, so re-running the
    // loader over a ?section= change would only refetch data this page
    // already has, for no benefit beyond a URL that matches — pointless
    // network round trip and a scroll-position reset to boot.
    window.history.replaceState(null, "", `/read/${work.id}?section=${target.sectionId}`);
  }

  // Deep-linking to a specific section (?section=<id>) still has to move
  // the reader there once, since the column otherwise always mounts at
  // the top of the whole work. Runs once — scrollToRow's own estimate-vs-
  // measured accuracy caveat applies most here, jumping potentially dozens
  // of chapters on nothing but ESTIMATED_PARAGRAPH_HEIGHT_PX guesses.
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (didInitialScroll.current) return;
    didInitialScroll.current = true;
    const firstSection = work.chapters[0]?.sections[0];
    if (initialSection && initialSection.sectionId !== firstSection?.id) {
      scrollToRow(`divider:${initialSection.sectionId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scoped to marginaliaOrdinalRange (#55, phase 4 of #51) — the whole
  // work's entries/highlights are loaded (phase 1, #53), but marginalia
  // only ever shows whichever of them anchor inside the
  // currently-virtualized window (or the landing section, before the
  // first scroll settle). The grouping/scoping logic itself lives in
  // app/domain/paragraph/marginalia.ts, with its own direct tests.
  // Memoized so this only re-derives when paragraphs or the ordinal range
  // actually change, not on every render — without it, every
  // useBookmarkTracker scroll-settle tick and every virtualization state
  // update (row mounts/unmounts as the reader scrolls) re-ran both derivations
  // over the whole work's paragraphs for no reason. marginaliaOrdinalRange
  // only changes via setState inside useBookmarkTracker, so comparing it by
  // reference (React's default for useMemo deps) is correct here — no need
  // to deep-compare its two numbers.
  const entries = useMemo(
    () => deriveEntries(paragraphs, marginaliaOrdinalRange),
    [paragraphs, marginaliaOrdinalRange],
  );
  const highlights = useMemo(
    () => deriveHighlights(paragraphs, marginaliaOrdinalRange),
    [paragraphs, marginaliaOrdinalRange],
  );

  return (
    <div className="flex h-screen flex-col bg-surface">
      <ReaderHeader
        workId={work.id}
        workTitle={work.title}
        progressPercent={progressPercent}
        timeLeft={timeLeft}
        onPreviousSection={previousSection ? () => jumpToSection(previousSection) : null}
        onNextSection={nextSection ? () => jumpToSection(nextSection) : null}
      />

      <div className="flex min-h-0 flex-1">
        <PageStack progress={progressPercent / 100} side="read" className="flex-none" />

        <SelectionHighlighter>
          <div
            ref={readingColumnRef}
            className="min-w-0 flex-1 overflow-y-auto bg-bg px-16 pt-12"
          >
            <div className="mx-auto max-w-[660px]">
              {/* Spacers stand in for every unmounted row's combined height so
                  scroll height (and the scrollbar's own proportions) stay
                  correct without the whole book existing as real DOM nodes. */}
              <div style={{ height: topSpacerHeight }} />
              {rows.slice(startIndex, endIndex).map((row) =>
                row.type === "divider" ? (
                  <ChapterSectionDivider
                    key={row.id}
                    ref={registerRowRef(row.id)}
                    chapterOrdinal={row.chapterOrdinal}
                    sectionOrdinal={row.sectionOrdinal}
                  />
                ) : (
                  <ReadingParagraph
                    key={row.id}
                    ref={registerRowRef(row.id)}
                    paragraph={row.paragraph}
                    highlights={row.paragraph.highlightSpans.map((s) => ({
                      start: s.startOffset,
                      end: s.endOffset,
                      className: highlightClassName(s.highlight.role),
                    }))}
                  />
                ),
              )}
              <div style={{ height: bottomSpacerHeight }} />
              {paragraphs.length === 0 && (
                <p className="text-sm opacity-50">This work has no ingested text yet.</p>
              )}
            </div>
          </div>
        </SelectionHighlighter>

        <PageStack progress={progressPercent / 100} side="toGo" className="flex-none" />

        <PostureRail />

        <MarginaliaSidebar entries={entries} highlights={highlights} />
      </div>
    </div>
  );
}
