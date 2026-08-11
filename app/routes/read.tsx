import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { db } from "~/db.server";
import { requireUser } from "~/user.server";
import { ChapterSectionDivider } from "~/components/ChapterSectionDivider";
import { PageStack } from "~/components/PageStack";
import { ReaderHeader } from "~/components/ReaderHeader";
import { ReadingParagraph } from "~/components/ReadingParagraph";
import { ReadingParagraphSkeleton } from "~/components/ReadingParagraphSkeleton";
import { SelectionHighlighter } from "~/components/SelectionHighlighter";
import { MarginaliaSidebar } from "~/components/MarginaliaSidebar";
import { useBookmarkTracker } from "~/components/useBookmarkTracker";
import { useContentWindow } from "~/components/useContentWindow";
import { useVirtualizedRows } from "~/components/useVirtualizedRows";
import { track, canonicalRequestUrl, type AnalyticsEvent } from "~/analytics.server";
import { sendAnalyticsBeacon } from "~/analyticsBeacon";
import { formatLocator, formatLocatorRange } from "~/domain/locator";
import { highlightClassName } from "~/domain/paragraph/highlightRole";
import { assertParagraphsAnnotatableBy } from "~/domain/paragraph/assertParagraphsAnnotatableBy.server";
import { deriveEntries, deriveHighlights } from "~/domain/paragraph/marginalia";
import { buildOnScreenExcerpt } from "~/domain/paragraph/onScreenExcerpt";
import { computeProgressPercent, computeReadingProgress } from "~/domain/reading/readingProgress";
import { selectInitialContentWindow } from "~/domain/reading/contentWindow";
import { fetchContentWindow } from "~/domain/reading/fetchContentWindow.server";
import { readPageTitle } from "~/domain/reading/pageTitle";
import { buildRigLaunchContext, formatOnScreenExcerpt } from "~/rig/buildLaunchContext";
import type { OrdinalRange } from "~/domain/reading/scrollPosition";
import {
  nextSectionRef,
  previousSectionRef,
  resolveSectionRef,
  type SectionRef,
} from "~/domain/reading/sectionNavigation";
import type { Route } from "./+types/read";

// Code-split: RigLivePanel pulls in TokenComposer's mention search UI, which
// is bulky enough to matter against this page's own Lighthouse script-size
// budget (lighthouserc.cjs) but is only needed once a reader actually opens
// the Rig — see rigMounted below.
const RigLivePanel = lazy(() =>
  import("~/components/RigLivePanel").then((m) => ({ default: m.RigLivePanel })),
);

// Rough guesses used only until useVirtualizedRows' ResizeObserver reports
// each row's real height — just enough that the very first paint windows
// correctly around the initial scroll position instead of mounting the
// whole book. A paragraph's average is ~2-3 lines at 17.5px/1.8 leading in
// the 660px reading column, plus its own mb-5; a divider is one line plus
// its mb-6.
const ESTIMATED_PARAGRAPH_HEIGHT_PX = 110;
const ESTIMATED_DIVIDER_HEIGHT_PX = 64;

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? readPageTitle(loaderData.work.title) : "Reading Rig" }];
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
      section: { select: { id: true, ordinal: true, chapter: { select: { id: true, ordinal: true } } } },
    },
  });

  // Where the content window centers: the landing section's first
  // paragraph, or globalOrdinal 1 when no section was requested (or it
  // didn't resolve to one — see resolveSectionRef above) — "defaults to
  // the start" falls out of the same lookup, not a separate branch.
  const anchorGlobalOrdinal =
    (initialSection &&
      structuralParagraphs.find((p) => p.section.id === initialSection.sectionId && p.ordinal === 1)
        ?.globalOrdinal) ??
    1;

  // Only a byte-budgeted slice of paragraphs actually gets html/text/
  // highlightSpans/entries up front — this is the payload Lighthouse's
  // document-size budget was blowing past at whole-book scale (see
  // lighthouserc.cjs). useContentWindow (client-side) fetches more from
  // /read-content as the reader's mounted DOM window approaches either
  // edge of what's loaded here.
  const contentRange = selectInitialContentWindow(structuralParagraphs, anchorGlobalOrdinal);
  const contentParagraphs = contentRange ? await fetchContentWindow(db, work.id, contentRange) : [];

  const position = await db.readingPosition.findUnique({
    where: { userId_workId: { userId: user.id, workId: work.id } },
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
  //
  // computeReadingProgress (app/domain/reading/readingProgress.ts) is the
  // one place that math lives — the client re-runs the exact same function
  // after each scroll-settle debounce (#54, phase 3 of #51), against the
  // structural paragraphs this same loader already puts in memory, rather
  // than a second implementation that could drift from this one.
  const totalParagraphs = structuralParagraphs.length;
  const { progressPercent, timeLeft } = computeReadingProgress(
    structuralParagraphs.map((p) => ({ globalOrdinal: p.globalOrdinal, wordCount: p.wordCount })),
    totalParagraphs,
    bookmarkGlobalOrdinal,
  );

  await track(
    {
      name: "work_opened",
      workId: work.id,
      title: work.title,
      startingOrdinal: anchorGlobalOrdinal,
      // A bookmark existing at all is the difference between resuming and
      // opening a work for the first time.
      isResume: position !== null,
      isDeepLink: sectionIdParam !== null,
      bookmarkGlobalOrdinal,
      progressPercent,
      totalParagraphs,
      chapterCount: work.chapters.length,
    },
    { distinctId: user.id, currentUrl: canonicalRequestUrl(request), screenName: readPageTitle(work.title) },
  );

  return {
    work,
    structuralParagraphs,
    content: contentRange
      ? { paragraphs: contentParagraphs, minGlobalOrdinal: contentRange.minGlobalOrdinal, maxGlobalOrdinal: contentRange.maxGlobalOrdinal }
      : { paragraphs: contentParagraphs, minGlobalOrdinal: 0, maxGlobalOrdinal: 0 },
    initialSection,
    bookmarkGlobalOrdinal,
    progressPercent,
    timeLeft,
  };
}

type SpanRange = { paragraphId: string; start: number; end: number };

function parseSpans(formData: FormData): SpanRange[] {
  return JSON.parse(String(formData.get("spans"))) as SpanRange[];
}

// What analytics.server.ts's highlight_created / note_created events carry,
// derived from what each handler below has already resolved. Shared by the
// two handlers that make a highlight (and the two that make a note) so the
// derivation lives in one place rather than twice.
//
// Lengths and locators only — never the highlighted or written text itself
// (#78). Read the event types before adding a property here.
type TrackedSpan = { paragraphId: string; start: number; end: number };
type TrackedParagraph = {
  id: string;
  ordinal: number;
  section: { ordinal: number; chapter: { ordinal: number; workId: string; work: { title: string } } };
};

// assertParagraphsAnnotatableBy already answered "may this user touch these
// paragraphs" — this is a second, unfiltered query for the ordinals/workId
// the event payload needs, not a second access check. `work.title` rides
// along on the same query — screenName's own `readPageTitle` needs it, and
// this is already the one query these handlers make for this paragraph.
function selectTrackedParagraphs(paragraphIds: string[]) {
  return db.paragraph.findMany({
    where: { id: { in: paragraphIds } },
    select: {
      id: true,
      ordinal: true,
      section: {
        select: {
          ordinal: true,
          chapter: { select: { ordinal: true, workId: true, work: { select: { title: true } } } },
        },
      },
    },
  });
}

function highlightCreatedEvent(
  spans: TrackedSpan[],
  paragraphs: TrackedParagraph[],
  { withNote }: { withNote: boolean },
): AnalyticsEvent {
  // Every span's paragraph is in `paragraphs` — both call sites resolve it
  // from the same set of ids they just fetched.
  const byId = new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph]));
  // `spans` arrives in document order from resolveSelectionSpans, so its
  // two ends are the highlight's two ends.
  const first = byId.get(spans[0].paragraphId)!;
  const last = byId.get(spans[spans.length - 1].paragraphId)!;

  return {
    name: "highlight_created",
    workId: first.section.chapter.workId,
    locator: formatLocatorRange(
      { sectionLabel: String(first.section.ordinal), paragraphOrdinal: first.ordinal },
      { sectionLabel: String(last.section.ordinal), paragraphOrdinal: last.ordinal },
    ),
    // Every highlight made through this UI is role: hand — the Rig can't
    // make one until M3.
    role: "hand",
    textLength: spans.reduce((total, span) => total + (span.end - span.start), 0),
    paragraphCount: spans.length,
    sectionOrdinal: first.section.ordinal,
    chapterOrdinal: first.section.chapter.ordinal,
    // Section ordinals are only unique within a chapter, so both halves
    // have to match for this to be one section's worth of highlight.
    spansSections:
      first.section.ordinal !== last.section.ordinal ||
      first.section.chapter.ordinal !== last.section.chapter.ordinal,
    withNote,
  };
}

function noteCreatedEvent(
  anchor: TrackedParagraph,
  { body, excerpt, hasHighlightRef }: { body: string; excerpt: string; hasHighlightRef: boolean },
): AnalyticsEvent {
  return {
    name: "note_created",
    workId: anchor.section.chapter.workId,
    locator: formatLocator({
      sectionLabel: String(anchor.section.ordinal),
      paragraphOrdinal: anchor.ordinal,
    }),
    origin: "hand",
    hasHighlightRef,
    hasExcerpt: excerpt.length > 0,
    bodyLength: body.length,
    excerptLength: excerpt.length,
    sectionOrdinal: anchor.section.ordinal,
    chapterOrdinal: anchor.section.chapter.ordinal,
  };
}

type ActionUser = { id: string };

async function handleHighlight(user: ActionUser, formData: FormData, currentUrl: string) {
  const spans = parseSpans(formData);

  // Checked for every paragraph a spanning highlight touches, not just one.
  await assertParagraphsAnnotatableBy(db, user.id, spans.map((s) => s.paragraphId));

  // Every highlight made through this UI is role: hand — there's no Rig
  // yet to make the other kind (that's M3's). One Highlight, one
  // HighlightSpan per paragraph it reaches. Overlap with existing
  // highlights is allowed (#48) — nested marks with compounding opacity
  // are the rendered result, not an error.
  await db.highlight.create({
    data: {
      userId: user.id,
      role: "hand",
      spans: {
        create: spans.map((s) => ({ paragraphId: s.paragraphId, startOffset: s.start, endOffset: s.end })),
      },
    },
  });
  const trackedParagraphs = await selectTrackedParagraphs(spans.map((s) => s.paragraphId));
  await track(highlightCreatedEvent(spans, trackedParagraphs, { withNote: false }), {
    distinctId: user.id,
    currentUrl,
    screenName: readPageTitle(trackedParagraphs[0].section.chapter.work.title),
  });
  return { ok: true as const };
}

async function handleHighlightNote(user: ActionUser, formData: FormData, currentUrl: string) {
  // A note about a *fresh* spanning selection — there's no Highlight yet
  // for it to reference (unlike handleNote below, which attaches to one
  // that already exists), so this creates both together in one
  // transaction: cancelling the note composer before this ever fires
  // leaves nothing behind, and there's no window where the Highlight
  // exists without the note that was actually the point.
  const spans = parseSpans(formData);
  await assertParagraphsAnnotatableBy(db, user.id, spans.map((s) => s.paragraphId));

  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Response("A note needs a body", { status: 400 });
  const excerpt = String(formData.get("excerpt") ?? "");

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
        // The first paragraph the selection reaches — same "coarser than
        // Highlight, on purpose" anchor every Entry uses (see the model
        // comment in schema.prisma). `spans` arrives in document order
        // from resolveSelectionSpans, so spans[0] is it.
        anchorParagraphId: spans[0].paragraphId,
        highlightId: highlight.id,
        contextSnapshot: { excerpt },
      },
    });
  });

  // Two events, because two things were made — a highlight that happens to
  // carry a note is still a highlight, and counting it only as a note
  // would make hand-highlighting look rarer than it is.
  const trackedParagraphs = await selectTrackedParagraphs(spans.map((s) => s.paragraphId));
  const anchor = trackedParagraphs.find((paragraph) => paragraph.id === spans[0].paragraphId)!;
  const screenName = readPageTitle(anchor.section.chapter.work.title);
  await track(highlightCreatedEvent(spans, trackedParagraphs, { withNote: true }), {
    distinctId: user.id,
    currentUrl,
    screenName,
  });
  await track(noteCreatedEvent(anchor, { body, excerpt, hasHighlightRef: true }), {
    distinctId: user.id,
    currentUrl,
    screenName,
  });
  return { ok: true as const };
}

async function handleNote(user: ActionUser, formData: FormData, currentUrl: string) {
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
  const excerpt = String(formData.get("excerpt") ?? "");
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
      contextSnapshot: { excerpt },
    },
  });
  const [anchor] = await selectTrackedParagraphs([paragraphId]);
  await track(noteCreatedEvent(anchor, { body, excerpt, hasHighlightRef: highlightId !== null }), {
    distinctId: user.id,
    currentUrl,
    screenName: readPageTitle(anchor.section.chapter.work.title),
  });
  return { ok: true as const };
}

async function handleBookmark(user: ActionUser, formData: FormData, currentUrl: string) {
  const paragraphId = String(formData.get("paragraphId"));

  // Same annotatable-access boundary the loader enforces: a paragraph
  // only exists for this action if it resolves back to a Work this user
  // may annotate.
  const paragraph = await db.paragraph.findFirst({
    where: { id: paragraphId, section: { chapter: { work: { ownerId: user.id } } } },
    select: {
      // globalOrdinal and the two ordinals are bookmark_updated's; the
      // workId was already needed by the upsert below, and work.title
      // rides along the same way selectTrackedParagraphs' does — for
      // screenName, not a second query.
      globalOrdinal: true,
      section: {
        select: {
          ordinal: true,
          chapter: { select: { ordinal: true, workId: true, work: { select: { title: true } } } },
        },
      },
    },
  });
  if (!paragraph) throw new Response("Not found", { status: 404 });

  const workId = paragraph.section.chapter.workId;
  await db.readingPosition.upsert({
    where: { userId_workId: { userId: user.id, workId } },
    update: { paragraphId },
    create: { userId: user.id, workId, paragraphId },
  });

  // The loader gets its denominator from the paragraphs it already loaded;
  // this handler never loads them, so it counts instead — and runs the
  // same computeProgressPercent, so "12%" here and "12%" in the header are
  // the same number by construction, not by coincidence.
  const totalParagraphs = await db.paragraph.count({ where: { section: { chapter: { workId } } } });
  await track(
    {
      name: "bookmark_updated",
      workId,
      globalOrdinal: paragraph.globalOrdinal,
      progressPercent: computeProgressPercent(totalParagraphs, paragraph.globalOrdinal),
      totalParagraphs,
      sectionOrdinal: paragraph.section.ordinal,
      chapterOrdinal: paragraph.section.chapter.ordinal,
    },
    { distinctId: user.id, currentUrl, screenName: readPageTitle(paragraph.section.chapter.work.title) },
  );
  return { ok: true as const };
}

// One handler per intent the reading UI can submit — highlight/write-a-note
// forms, and the bookmark tracker's own fetcher.submit (see
// useBookmarkTracker). Keyed by the same `intent` value the form (or
// SelectionHighlighter/useBookmarkTracker's fetcher.submit) sends.
const actionHandlers = {
  highlight: handleHighlight,
  "highlight-note": handleHighlightNote,
  note: handleNote,
  bookmark: handleBookmark,
} satisfies Record<string, (user: ActionUser, formData: FormData, currentUrl: string) => Promise<{ ok: true }>>;

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser();
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  const handler = Object.prototype.hasOwnProperty.call(actionHandlers, intent)
    ? actionHandlers[intent as keyof typeof actionHandlers]
    : undefined;
  if (!handler) throw new Response("Unknown intent", { status: 400 });

  return handler(user, formData, canonicalRequestUrl(request));
}

// One row per thing that actually occupies vertical space in the
// continuous reading column — a paragraph, or a chapter/section divider
// immediately before that section's first paragraph. useVirtualizedRows
// mounts/unmounts by row, not by paragraph alone, so a divider has to be
// a row in its own right or its height would never be accounted for in
// the spacer math.
// The whole-work structural row — id/ordinals/wordCount, no html/text.
// `content`'s own paragraph shape (html/text/highlightSpans/entries) is
// only ever available for whichever of these useContentWindow has fetched.
type StructuralRowParagraph = Route.ComponentProps["loaderData"]["structuralParagraphs"][number];
type ReadingRow =
  | { type: "divider"; id: string; chapterOrdinal: number; sectionOrdinal: number }
  | { type: "paragraph"; id: string; structural: StructuralRowParagraph };

export default function Read({ loaderData }: Route.ComponentProps) {
  const {
    work,
    structuralParagraphs,
    content,
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
    for (const paragraph of structuralParagraphs) {
      if (paragraph.ordinal === 1) {
        result.push({
          type: "divider",
          id: `divider:${paragraph.section.id}`,
          chapterOrdinal: paragraph.section.chapter.ordinal,
          sectionOrdinal: paragraph.section.ordinal,
        });
      }
      result.push({ type: "paragraph", id: paragraph.id, structural: paragraph });
    }
    return result;
  }, [structuralParagraphs]);

  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const initialHeights = useMemo(
    () => rows.map((row) => (row.type === "divider" ? ESTIMATED_DIVIDER_HEIGHT_PX : ESTIMATED_PARAGRAPH_HEIGHT_PX)),
    [rows],
  );

  const readingColumnRef = useRef<HTMLDivElement>(null);
  const { startIndex, endIndex, topSpacerHeight, bottomSpacerHeight, registerRowRef, scrollToRow } =
    useVirtualizedRows({
      containerRef: readingColumnRef,
      rowIds,
      initialHeights,
      initialAnchorRowId: initialSection ? `divider:${initialSection.sectionId}` : undefined,
    });

  // Which structural paragraphs are actually mounted right now — the
  // globalOrdinal span useContentWindow watches to decide whether to fetch
  // more (contentFetchTargets, app/domain/reading/contentWindow.ts).
  // Independent of marginaliaOrdinalRange below: this tracks the DOM mount
  // window itself, not the coarser scroll-settle-debounced range
  // useBookmarkTracker computes.
  const mountedOrdinalRange = useMemo<OrdinalRange | null>(() => {
    const mountedParagraphs = rows.slice(startIndex, endIndex).filter((row) => row.type === "paragraph");
    if (mountedParagraphs.length === 0) return null;
    return {
      minGlobalOrdinal: mountedParagraphs[0].structural.globalOrdinal,
      maxGlobalOrdinal: mountedParagraphs[mountedParagraphs.length - 1].structural.globalOrdinal,
    };
  }, [rows, startIndex, endIndex]);

  const { contentById, refreshParagraphs } = useContentWindow({
    workId: work.id,
    structuralParagraphs,
    initialContent: content,
    mountedOrdinalRange,
  });

  // SectionNav's own notion of "where am I" — it moves both when
  // SectionNav is clicked (jumpToSection, below) and whenever the
  // scroll-settle debounce below resolves to a different section (#54);
  // either way the URL is kept in sync with whichever one moved it last,
  // and either way it's a `section_navigated` (see handleSectionChangeFromScroll).
  const [currentSectionRef, setCurrentSectionRef] = useState<SectionRef | null>(initialSection);
  const [rigOpen, setRigOpen] = useState(false);
  // Stays true forever once the reader's first open flips it — same "never
  // tears down once opened" lifetime RigPanel's own translate-x-full trick
  // gives the live session after that point, just deferred past the code
  // itself loading rather than from page mount.
  const [rigMounted, setRigMounted] = useState(false);
  const [rigContext, setRigContext] = useState<string | null>(null);
  const previousSection = currentSectionRef ? previousSectionRef(work.chapters, currentSectionRef) : null;
  const nextSection = currentSectionRef ? nextSectionRef(work.chapters, currentSectionRef) : null;

  function sectionOutline(ref: SectionRef): { chapterOrdinal: number; sectionOrdinal: number } | null {
    const chapter = work.chapters.find((c) => c.id === ref.chapterId);
    const section = chapter?.sections.find((s) => s.id === ref.sectionId);
    return chapter && section ? { chapterOrdinal: chapter.ordinal, sectionOrdinal: section.ordinal } : null;
  }

  // Every section in the work, in reading order — lets reportSectionNavigated
  // work out how many sections a jump actually covered (sectionOutline's own
  // ordinals reset per chapter, so they can't answer that alone). A SectionNav
  // click is always exactly one step in this list; a scroll-settle can be
  // several, if the reader flew past more than one section in one motion.
  const sectionOrder = useMemo(
    () => work.chapters.flatMap((c) => c.sections.map((s) => ({ chapterId: c.id, sectionId: s.id }))),
    [work.chapters],
  );
  function sectionIndex(ref: SectionRef): number {
    return sectionOrder.findIndex((s) => s.chapterId === ref.chapterId && s.sectionId === ref.sectionId);
  }

  // How long to wait after the last section change before reporting the
  // burst it was part of — long enough that a reader stepping through
  // several sections in quick succession (via SectionNav or a fast scroll)
  // reads as one navigation action (section_navigated's own doc comment in
  // analytics.server.ts), short enough that it still reads as "this
  // session's nav," not some unrelated later one.
  const NAV_BURST_DEBOUNCE_MS = 1500;
  type NavBurst = {
    fromChapterOrdinal: number;
    fromSectionOrdinal: number;
    toChapterOrdinal: number;
    toSectionOrdinal: number;
    delta: number;
  };
  const navBurstRef = useRef<NavBurst | null>(null);
  const navBurstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sends whatever burst is pending, right now, instead of waiting out the
  // rest of the debounce window. `sendAnalyticsBeacon` only closes over
  // plain values (no component state, no DOM), so firing it after unmount
  // is exactly as safe as firing it before — there's nothing here that
  // needs the component to still be mounted. Used both by the debounce
  // timer itself and by the unmount cleanup below; without the latter, a
  // reader who clicks "next" and then navigates away (a real path — #124's
  // Lighthouse pass and manual staging testing both do exactly this) would
  // have its burst silently discarded mid-debounce instead of reported.
  function flushNavBurst() {
    if (navBurstTimerRef.current) {
      clearTimeout(navBurstTimerRef.current);
      navBurstTimerRef.current = null;
    }
    const burst = navBurstRef.current;
    navBurstRef.current = null;
    if (!burst) return;
    sendAnalyticsBeacon({ name: "section_navigated", workId: work.id, ...burst });
  }

  useEffect(() => {
    return flushNavBurst;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The one place a section change turns into a report, for both of
  // currentSectionRef's movers (see its own comment above): jumpToSection
  // passes an adjacent `from`/`to` (always a one-section step);
  // handleSectionChangeFromScroll passes whatever useBookmarkTracker's
  // settle resolved to, which can be several sections past wherever the
  // reader last settled. Either way `delta` is `to`'s index in
  // `sectionOrder` minus `from`'s — not a fixed +/-1 — so a multi-section
  // scroll jump reports its real size instead of undercounting it as one.
  function reportSectionNavigated(from: SectionRef | null, to: SectionRef) {
    const toOutline = sectionOutline(to);
    if (!toOutline) return;

    const existing = navBurstRef.current;
    const fromOutline = existing
      ? { chapterOrdinal: existing.fromChapterOrdinal, sectionOrdinal: existing.fromSectionOrdinal }
      : from && sectionOutline(from);
    if (!fromOutline) return;

    const stepDelta = from ? sectionIndex(to) - sectionIndex(from) : 0;

    navBurstRef.current = {
      fromChapterOrdinal: fromOutline.chapterOrdinal,
      fromSectionOrdinal: fromOutline.sectionOrdinal,
      toChapterOrdinal: toOutline.chapterOrdinal,
      toSectionOrdinal: toOutline.sectionOrdinal,
      delta: (existing?.delta ?? 0) + stepDelta,
    };

    if (navBurstTimerRef.current) clearTimeout(navBurstTimerRef.current);
    navBurstTimerRef.current = setTimeout(flushNavBurst, NAV_BURST_DEBOUNCE_MS);
  }

  // useBookmarkTracker's own scroll-settle mover of currentSectionRef (see
  // its comment above) — reads the pre-update value out of the closure
  // before replacing it, same as jumpToSection's own `from` capture below.
  function handleSectionChangeFromScroll(section: SectionRef) {
    reportSectionNavigated(currentSectionRef, section);
    setCurrentSectionRef(section);
  }

  // Per paragraph: everything useBookmarkTracker needs to resolve "current
  // section" and recompute progress/timeLeft client-side, without a
  // second fetch — wordCount comes straight off the structural tier
  // (precomputed at ingest), which is why this never needed the content
  // window's html/text to begin with.
  const paragraphInfoById = useMemo(
    () =>
      Object.fromEntries(
        structuralParagraphs.map((p) => [
          p.id,
          {
            globalOrdinal: p.globalOrdinal,
            wordCount: p.wordCount,
            section: { chapterId: p.section.chapter.id, sectionId: p.section.id },
          },
        ]),
      ),
    [structuralParagraphs],
  );

  const { progressPercent, timeLeft, visibleOrdinalRange } = useBookmarkTracker({
    containerRef: readingColumnRef,
    workId: work.id,
    paragraphs: paragraphInfoById,
    totalParagraphs: structuralParagraphs.length,
    initialGlobalOrdinal: bookmarkGlobalOrdinal,
    initialProgressPercent,
    initialTimeLeft,
    onSectionChange: handleSectionChangeFromScroll,
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
    const ordinals = structuralParagraphs
      .filter((p) => p.section.id === initialSection.sectionId)
      .map((p) => p.globalOrdinal);
    if (ordinals.length === 0) return null;
    return { minGlobalOrdinal: Math.min(...ordinals), maxGlobalOrdinal: Math.max(...ordinals) };
  }, [structuralParagraphs, initialSection]);

  const marginaliaOrdinalRange = visibleOrdinalRange ?? initialSectionOrdinalRange;

  function jumpToSection(target: SectionRef) {
    scrollToRow(`divider:${target.sectionId}`);
    const from = currentSectionRef;
    setCurrentSectionRef(target);
    // A plain history update, not a react-router navigation: the whole
    // work's paragraphs are already loaded client-side, so re-running the
    // loader over a ?section= change would only refetch data this page
    // already has, for no benefit beyond a URL that matches — pointless
    // network round trip and a scroll-position reset to boot.
    window.history.replaceState(null, "", `/read/${work.id}?section=${target.sectionId}`);
    reportSectionNavigated(from, target);
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

  // Scoped to marginaliaOrdinalRange (#55, phase 4 of #51) — marginalia
  // only ever shows whichever entries/highlights anchor inside the
  // currently-virtualized window (or the landing section, before the
  // first scroll settle). marginalia.ts's own contract was always
  // "whatever paragraphs you hand me, not necessarily the whole book" —
  // it needs zero changes for windowing, as long as
  // marginaliaOrdinalRange stays inside mountedOrdinalRange stays inside
  // whatever useContentWindow has actually fetched, which holds by
  // construction (the content byte budget comfortably exceeds the DOM
  // overscan window, and the lead-fetch threshold fires before mounted
  // rows reach the fetched edge). Structural paragraphs with no content
  // loaded yet are simply absent from this merged list, same as if they
  // didn't exist — correct, since nothing currently mounted can be one of
  // them (see the invariant above).
  const marginaliaSourceParagraphs = useMemo(
    () =>
      structuralParagraphs.flatMap((p) => {
        const loaded = contentById[p.id];
        return loaded ? [{ ...p, ...loaded }] : [];
      }),
    [structuralParagraphs, contentById],
  );
  const entries = deriveEntries(marginaliaSourceParagraphs, marginaliaOrdinalRange);
  const highlights = deriveHighlights(marginaliaSourceParagraphs, marginaliaOrdinalRange);

  // TokenComposer's pinned "in view" suggestion (#117 follow-up) — same
  // source paragraphs and range marginalia itself scopes to, so the token
  // always agrees with what the margin rail is currently showing as "here".
  const onScreenExcerpt = useMemo(
    () => buildOnScreenExcerpt(marginaliaSourceParagraphs, marginaliaOrdinalRange),
    [marginaliaSourceParagraphs, marginaliaOrdinalRange],
  );

  const workMeta = { title: work.title, author: work.author };

  function handleOpenRigFromHeader() {
    const excerpt = formatOnScreenExcerpt(marginaliaSourceParagraphs, marginaliaOrdinalRange);
    sendAnalyticsBeacon({ name: "rig_opened", workId: work.id, source: "header", hasContext: excerpt !== "" });
    setRigContext(excerpt ? buildRigLaunchContext(workMeta, excerpt) : null);
    setRigMounted(true);
    setRigOpen(true);
  }

  function handleAskRigFromSelection(excerpt: string) {
    sendAnalyticsBeacon({ name: "rig_opened", workId: work.id, source: "selection", hasContext: true });
    setRigContext(buildRigLaunchContext(workMeta, excerpt));
    setRigMounted(true);
    setRigOpen(true);
  }

  return (
    <div className="flex h-screen flex-col bg-surface">
      <ReaderHeader
        workId={work.id}
        workTitle={work.title}
        progressPercent={progressPercent}
        timeLeft={timeLeft}
        onPreviousSection={previousSection ? () => jumpToSection(previousSection) : null}
        onNextSection={nextSection ? () => jumpToSection(nextSection) : null}
        onOpenRig={handleOpenRigFromHeader}
      />

      {rigMounted && (
        <Suspense fallback={null}>
          <RigLivePanel
            workId={work.id}
            workTitle={work.title}
            open={rigOpen}
            onClose={() => setRigOpen(false)}
            context={rigContext}
            onScreenExcerpt={onScreenExcerpt}
          />
        </Suspense>
      )}

      <div className="flex min-h-0 flex-1">
        <PageStack progress={progressPercent / 100} side="read" className="flex-none" />

        <SelectionHighlighter onAskRig={handleAskRigFromSelection} onSaved={refreshParagraphs}>
          {/* Both overlays below are positioned against SelectionHighlighter's
              own (non-scrolling) wrapper, not the scrollable column —
              staying inside the scrollable column would make either one an
              absolutely positioned descendant of an overflow:auto element,
              which scrolls away with that element's own content instead of
              staying pinned to the reading pane. See organic.css's
              `.page-edge`/`.paper-grain` comments. */}
          <div aria-hidden className="page-edge pointer-events-none absolute inset-x-0 top-0 z-10 h-[2px]" />
          <div aria-hidden className="paper-grain pointer-events-none absolute inset-0" />
          <div
            ref={readingColumnRef}
            className="min-w-0 flex-1 overflow-y-auto bg-bg px-16 pt-12"
          >
            <div className="mx-auto max-w-reading">
              {/* Spacers stand in for every unmounted row's combined height so
                  scroll height (and the scrollbar's own proportions) stay
                  correct without the whole book existing as real DOM nodes. */}
              <div style={{ height: topSpacerHeight }} />
              {rows.slice(startIndex, endIndex).map((row) => {
                if (row.type === "divider") {
                  return (
                    <ChapterSectionDivider
                      key={row.id}
                      ref={registerRowRef(row.id)}
                      chapterOrdinal={row.chapterOrdinal}
                      sectionOrdinal={row.sectionOrdinal}
                    />
                  );
                }
                const paragraph = contentById[row.id];
                // Mounted (within the DOM window) but not yet fetched — a
                // fast scroll can outrun useContentWindow's lead-distance
                // trigger. Same ref/data-paragraph-id wiring either way, so
                // ResizeObserver and useBookmarkTracker's DOM scan keep
                // working across the swap once content arrives.
                if (!paragraph) {
                  return <ReadingParagraphSkeleton key={row.id} id={row.id} ref={registerRowRef(row.id)} />;
                }
                return (
                  <ReadingParagraph
                    key={row.id}
                    ref={registerRowRef(row.id)}
                    paragraph={paragraph}
                    highlights={paragraph.highlightSpans.map((s) => ({
                      id: s.highlight.id,
                      start: s.startOffset,
                      end: s.endOffset,
                      className: highlightClassName(s.highlight.role),
                      order: s.highlight.createdAt.getTime(),
                    }))}
                  />
                );
              })}
              <div style={{ height: bottomSpacerHeight }} />
              {structuralParagraphs.length === 0 && (
                <p className="text-sm opacity-50">This work has no ingested text yet.</p>
              )}
            </div>
          </div>
        </SelectionHighlighter>

        <PageStack progress={progressPercent / 100} side="toGo" className="flex-none" />

        <MarginaliaSidebar entries={entries} highlights={highlights} onSaved={refreshParagraphs} />
      </div>
    </div>
  );
}
