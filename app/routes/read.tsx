import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { db } from "~/db.server";
import { requireUser } from "~/user.server";
import { ChapterSectionDivider } from "~/components/ChapterSectionDivider";
import { PageStack } from "~/components/PageStack";
import { ReadingRail } from "~/components/ReadingRail";
import { ReadingParagraph } from "~/components/ReadingParagraph";
import { ReadingParagraphSkeleton } from "~/components/ReadingParagraphSkeleton";
import { SelectionHighlighter } from "~/components/SelectionHighlighter";
import { MarginaliaSidebar } from "~/components/MarginaliaSidebar";
import { useBookmarkTracker } from "~/components/useBookmarkTracker";
import { useContentWindow } from "~/components/useContentWindow";
import { useOptimisticAnnotations } from "~/components/useOptimisticAnnotations";
import {
  useVirtualizedRows,
  type ScrollAnchor,
} from "~/components/useVirtualizedRows";
import { track, trackContext, canonicalRequestUrl } from "~/analytics.server";
import { sendAnalyticsBeacon } from "~/analyticsBeacon";
import { formatLocatorRange } from "~/domain/locator";
import { highlightClassName } from "~/domain/paragraph/highlightRole";
import {
  deriveEntries,
  deriveHighlights,
  pendingEntryToDisplay,
  pendingHighlightToDisplay,
} from "~/domain/paragraph/marginalia";
import type { HighlightRange } from "~/domain/paragraph/mergeHighlights";
import { excerptFromSpans } from "~/domain/paragraph/excerptFromSpans";
import { buildOnScreenExcerpt } from "~/domain/paragraph/onScreenExcerpt";
import type { ElementSpan } from "~/domain/paragraph/resolveSelectionOffset";
import { fetchReadPageData } from "~/domain/reading/fetchReadPageData.server";
import { handleReadAction } from "~/domain/reading/handleReadAction.server";
import { readPageTitle } from "~/domain/reading/pageTitle";
import {
  buildRigLaunchContext,
  formatOnScreenExcerpt,
  type RigWorkMeta,
} from "~/rig/buildLaunchContext";
import type { PillSeed } from "~/components/TokenComposer";
import type { OrdinalRange } from "~/domain/reading/scrollPosition";
import {
  nextSectionRef,
  previousSectionRef,
  type SectionRef,
} from "~/domain/reading/sectionNavigation";
import { fraunceLinks } from "~/domain/typography/fraunceLinks";
import type { Route } from "./+types/read";

// The reading column is the whole reason Fraunces gets preloaded at all —
// see fraunceLinks.ts for why this isn't in root.tsx's global links.
export const links: Route.LinksFunction = () => fraunceLinks;

// Code-split: RigLivePanel pulls in TokenComposer's mention search UI, which
// is bulky enough to matter against this page's own Lighthouse script-size
// budget (lighthouserc.cjs) but is only needed once a reader actually opens
// the Rig — see rigMounted below.
const RigLivePanel = lazy(() =>
  import("~/components/RigLivePanel").then((m) => ({
    default: m.RigLivePanel,
  })),
);

// Row height guesses, used until useVirtualizedRows' ResizeObserver
// reports each row's real height. Every guess that turns out wrong is a
// correction that has to be absorbed later (useVirtualizedRows keeps the
// reader's anchor row fixed while that happens), so the closer these are,
// the less there is to absorb.
//
// This used to be a flat 110px per paragraph, which cannot work at any
// value: measured against the real rendered column, body prose runs a
// median of 284px while an endnotes chapter runs 32px, so a single
// constant is simultaneously 2.6x too small in one part of a work and
// 3.4x too big in another — the error changes sign, rather than just
// being imprecise.
//
// `wordCount` is already selected by the loader and shipped for every
// paragraph in the work, and it predicts rendered height almost exactly
// (r = 0.999 against 78 sampled rows), because the column is a fixed
// width with fixed leading: a paragraph's height is just its line count
// times its line height. That drops mean absolute error from ~165px to
// ~6px, at the cost of nothing.
//
// The constants below describe ReadingParagraph's own typography
// (text-[17.5px] leading-[1.8]) — revisit them alongside any change to it.
// Width is deliberately *not* a constant: how many words fit on a line is
// the whole point, and a narrow column fits fewer and so runs taller. A
// guess calibrated at the 660px desktop column would underestimate a phone
// by roughly the ratio of the two widths, on every paragraph in the work.
const READING_LINE_HEIGHT_PX = 17.5 * 1.8;
// Mean advance of a word plus its trailing space at 17.5px, derived from
// the measured fit of 13.6 words per line in the 660px column.
const AVERAGE_WORD_WIDTH_PX = 48.5;
// max-w-reading. What the server has to assume, since it cannot know the
// viewport; the client re-estimates against the real column on mount.
const DEFAULT_READING_COLUMN_WIDTH_PX = 660;
// One line of label plus its mb-6 (ChapterSectionDivider), measured.
const ESTIMATED_DIVIDER_HEIGHT_PX = 42;

function estimateParagraphHeightPx(
  wordCount: number,
  columnWidthPx: number,
): number {
  const wordsPerLine = Math.max(1, columnWidthPx / AVERAGE_WORD_WIDTH_PX);
  // Never below one line: a paragraph with a single word still occupies a
  // full line, and a zero-height row would make the windowing math treat
  // it as having no extent at all.
  const lines = Math.max(1, Math.ceil(wordCount / wordsPerLine));
  return lines * READING_LINE_HEIGHT_PX;
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: loaderData ? readPageTitle(loaderData.work.title) : "Reading Rig",
    },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const workId = params["*"];
  const sectionIdParam = new URL(request.url).searchParams.get("section");

  const data = await fetchReadPageData(db, user.id, workId, sectionIdParam);

  await track(
    {
      name: "work_opened",
      workId: data.work.id,
      title: data.work.title,
      startingOrdinal: data.anchorGlobalOrdinal,
      // A bookmark existing at all is the difference between resuming and
      // opening a work for the first time.
      isResume: data.isResume,
      isDeepLink: sectionIdParam !== null,
      bookmarkGlobalOrdinal: data.bookmarkGlobalOrdinal,
      progressPercent: data.progressPercent,
      totalParagraphs: data.structuralParagraphs.length,
      chapterCount: data.work.chapters.length,
    },
    trackContext(user.id, canonicalRequestUrl(request), data.work.title),
  );

  return data;
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const formData = await request.formData();
  return handleReadAction(db, user, formData, canonicalRequestUrl(request));
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
type StructuralRowParagraph =
  Route.ComponentProps["loaderData"]["structuralParagraphs"][number];
type ReadingRow =
  | {
      type: "divider";
      id: string;
      chapterOrdinal: number;
      sectionOrdinal: number;
    }
  | { type: "paragraph"; id: string; structural: StructuralRowParagraph };

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

/**
 * Owns the nav-burst debounce state behind `section_navigated` — both of
 * currentSectionRef's movers (SectionNav clicks via jumpToSection, and
 * scroll-settle via handleSectionChangeFromScroll) report through the
 * `reportSectionNavigated` this returns, same as before this was a hook;
 * only the state itself moved.
 */
function useSectionNavAnalytics(
  work: Route.ComponentProps["loaderData"]["work"],
) {
  function sectionOutline(
    ref: SectionRef,
  ): { chapterOrdinal: number; sectionOrdinal: number } | null {
    const chapter = work.chapters.find((c) => c.id === ref.chapterId);
    const section = chapter?.sections.find((s) => s.id === ref.sectionId);
    return chapter && section
      ? { chapterOrdinal: chapter.ordinal, sectionOrdinal: section.ordinal }
      : null;
  }

  // Every section in the work, in reading order — lets reportSectionNavigated
  // work out how many sections a jump actually covered (sectionOutline's own
  // ordinals reset per chapter, so they can't answer that alone). A SectionNav
  // click is always exactly one step in this list; a scroll-settle can be
  // several, if the reader flew past more than one section in one motion.
  const sectionOrder = useMemo(
    () =>
      work.chapters.flatMap((c) =>
        c.sections.map((s) => ({ chapterId: c.id, sectionId: s.id })),
      ),
    [work.chapters],
  );
  function sectionIndex(ref: SectionRef): number {
    return sectionOrder.findIndex(
      (s) => s.chapterId === ref.chapterId && s.sectionId === ref.sectionId,
    );
  }

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
    sendAnalyticsBeacon({
      name: "section_navigated",
      workId: work.id,
      ...burst,
    });
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
      ? {
          chapterOrdinal: existing.fromChapterOrdinal,
          sectionOrdinal: existing.fromSectionOrdinal,
        }
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

  return { reportSectionNavigated };
}

/**
 * Owns everything about getting the Rig open — the two launch paths
 * (MarginaliaSidebar's own "Ask the Rig", and a highlighted selection's
 * "Ask the Rig") and the state RigLivePanel reads once mounted. `rigMounted` stays true
 * forever once the reader's first open flips it — same "never tears down
 * once opened" lifetime RigPanel's own translate-x-full trick gives the
 * live session after that point, just deferred past the code itself
 * loading rather than from page mount.
 */
function useRigLauncher({
  workId,
  workMeta,
  marginaliaSourceParagraphs,
  marginaliaOrdinalRange,
  paragraphLocatorById,
}: {
  workId: string;
  workMeta: RigWorkMeta;
  marginaliaSourceParagraphs: { globalOrdinal: number; text: string }[];
  marginaliaOrdinalRange: OrdinalRange | null;
  paragraphLocatorById: Map<
    string,
    { ordinal: number; section: { ordinal: number } }
  >;
}) {
  const [rigOpen, setRigOpen] = useState(false);
  const [rigMounted, setRigMounted] = useState(false);
  const [rigContext, setRigContext] = useState<string | null>(null);
  // A highlighted selection's "Ask the Rig" click, as a pill for
  // TokenComposer to seed itself with — see PillSeed's own doc comment for
  // why this needs a nonce rather than just the candidate.
  const [rigSeedPill, setRigSeedPill] = useState<PillSeed | null>(null);
  const rigSeedNonceRef = useRef(0);

  function handleOpenRigFromSidebar() {
    const excerpt = formatOnScreenExcerpt(
      marginaliaSourceParagraphs,
      marginaliaOrdinalRange,
    );
    sendAnalyticsBeacon({
      name: "rig_opened",
      workId,
      // Still "header" — the analytics taxonomy's name for "the persistent
      // chrome launcher" (as opposed to a selection-triggered launch), kept
      // stable across the ReaderHeader -> MarginaliaSidebar move so past
      // and future rig_opened events stay comparable.
      source: "header",
      hasContext: excerpt !== "",
    });
    setRigContext(excerpt ? buildRigLaunchContext(workMeta, excerpt) : null);
    setRigMounted(true);
    setRigOpen(true);
  }

  // A highlighted selection: unlike the header's open (no excerpt to show
  // beyond what's on screen, so that stays a silent prepended `context`
  // string), the reader picked this text on purpose — it becomes a pill in
  // the composer instead, visible and removable, rather than text they
  // never see get sent ahead of their question.
  function handleAskRigFromSelection(spans: ElementSpan[]) {
    const text = excerptFromSpans(spans);
    const first = paragraphLocatorById.get(
      (spans[0].element as HTMLElement).dataset.paragraphId!,
    );
    const last = paragraphLocatorById.get(
      (spans[spans.length - 1].element as HTMLElement).dataset.paragraphId!,
    );
    const locator =
      first && last
        ? formatLocatorRange(
            {
              sectionLabel: String(first.section.ordinal),
              paragraphOrdinal: first.ordinal,
            },
            {
              sectionLabel: String(last.section.ordinal),
              paragraphOrdinal: last.ordinal,
            },
          )
        : "";
    sendAnalyticsBeacon({
      name: "rig_opened",
      workId,
      source: "selection",
      hasContext: true,
    });
    setRigContext(null);
    setRigSeedPill({
      candidate: { kind: "selection", text, locator },
      nonce: ++rigSeedNonceRef.current,
    });
    setRigMounted(true);
    setRigOpen(true);
  }

  return {
    rigOpen,
    setRigOpen,
    rigMounted,
    rigContext,
    rigSeedPill,
    handleOpenRigFromSidebar,
    handleAskRigFromSelection,
  };
}

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
      result.push({
        type: "paragraph",
        id: paragraph.id,
        structural: paragraph,
      });
    }
    return result;
  }, [structuralParagraphs]);

  // Where the reader came in. Everything before this row is deliberately
  // not rendered: reading runs forward, and a row above the fold whose
  // height is still a guess is exactly what shifts the column under the
  // reader when that guess is corrected. Slicing the list at the landing
  // anchor means there is nothing above the fold to guess about — the
  // reader's own position becomes offset 0, so a section deep link needs
  // no jump arithmetic at all, and no correction above them is possible.
  const initialLoadedStartIndex = useMemo(() => {
    if (!initialSection) return 0;
    const index = rows.findIndex(
      (row) => row.id === `divider:${initialSection.sectionId}`,
    );
    return index < 0 ? 0 : index;
  }, [rows, initialSection]);
  const [loadedStartIndex, setLoadedStartIndex] = useState(
    initialLoadedStartIndex,
  );
  // Where to put the reader once a change to loadedStartIndex has
  // rendered — see the layout effect below.
  const pendingScrollRef = useRef<ScrollAnchor | null>(null);

  // The section boundary immediately before what's loaded — where "load
  // previous section" goes. Scanning back for the nearest divider rather
  // than walking work.chapters keeps this in the same terms as the row
  // list it indexes into.
  const previousSectionStartIndex = useMemo(() => {
    for (let i = loadedStartIndex - 1; i >= 0; i--) {
      if (rows[i].type === "divider") return i;
    }
    return 0;
  }, [rows, loadedStartIndex]);

  const visibleRows = useMemo(
    () => rows.slice(loadedStartIndex),
    [rows, loadedStartIndex],
  );
  const rowIds = useMemo(() => visibleRows.map((row) => row.id), [visibleRows]);

  // How far back content may be fetched: the first paragraph the reader
  // can actually see. useContentWindow never reaches behind this on
  // approach — only an explicit jump or "load previous section" moves it.
  const backwardFloorOrdinal = useMemo(() => {
    const first = visibleRows.find((row) => row.type === "paragraph");
    return first ? first.structural.globalOrdinal : 1;
  }, [visibleRows]);

  // The width text actually wraps at. Starts at the server's assumption so
  // the first client render matches the markup it's hydrating, then follows
  // the real element — which covers both a viewport narrower than
  // max-w-reading and a live window resize, either of which changes every
  // unmeasured row's height at once.
  const readingMeasureRef = useRef<HTMLDivElement>(null);
  const [readingColumnWidth, setReadingColumnWidth] = useState(
    DEFAULT_READING_COLUMN_WIDTH_PX,
  );
  useEffect(() => {
    const element = readingMeasureRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const width = element.clientWidth;
      // Ignore a zero — an element that is display:none or not yet laid
      // out would otherwise re-estimate the whole work against no width.
      if (width > 0) setReadingColumnWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const initialHeights = useMemo(
    () =>
      visibleRows.map((row) =>
        row.type === "divider"
          ? ESTIMATED_DIVIDER_HEIGHT_PX
          : estimateParagraphHeightPx(
              row.structural.wordCount,
              readingColumnWidth,
            ),
      ),
    [visibleRows, readingColumnWidth],
  );

  const readingColumnRef = useRef<HTMLDivElement>(null);
  const {
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    registerRowRef,
    scrollToRow,
    captureAnchor,
  } = useVirtualizedRows({
    containerRef: readingColumnRef,
    rowIds,
    initialHeights,
    // No initialAnchorRowId: the list now starts at the landing row, so
    // the anchor is index 0 and the default window is already centered on
    // it. That's the whole point of slicing — where the reader lands stops
    // being a scroll offset to compute and becomes the top of the list.
  });

  // Which structural paragraphs are actually mounted right now — the
  // globalOrdinal span useContentWindow watches to decide whether to fetch
  // more (contentFetchTargets, app/domain/reading/contentWindow.ts).
  // Independent of marginaliaOrdinalRange below: this tracks the DOM mount
  // window itself, not the coarser scroll-settle-debounced range
  // useBookmarkTracker computes.
  const mountedOrdinalRange = useMemo<OrdinalRange | null>(() => {
    const mountedParagraphs = visibleRows
      .slice(startIndex, endIndex)
      .filter((row) => row.type === "paragraph");
    if (mountedParagraphs.length === 0) return null;
    return {
      minGlobalOrdinal: mountedParagraphs[0].structural.globalOrdinal,
      maxGlobalOrdinal:
        mountedParagraphs[mountedParagraphs.length - 1].structural
          .globalOrdinal,
    };
  }, [visibleRows, startIndex, endIndex]);

  const { contentById, refreshParagraphs } = useContentWindow({
    workId: work.id,
    structuralParagraphs,
    initialContent: content,
    backwardFloorOrdinal,
    mountedOrdinalRange,
  });

  const optimistic = useOptimisticAnnotations();

  // Both SelectionHighlighter and MarginaliaSidebar's HighlightNoteComposer
  // report a save through this one path: kick off the refetch for the
  // paragraphs it touched, and once that refetch has actually landed
  // (`refreshParagraphs`' own onResolved — not the save's POST resolving,
  // which only means the database write happened, not that contentById
  // has caught up to it yet) drop whatever was shown optimistically for
  // it. Keeping the pending overlay alive until then is what makes the
  // swap invisible — real data replaces it before it's ever taken away.
  function handleAnnotationSaved(paragraphIds: string[], tempIds: string[]) {
    refreshParagraphs(paragraphIds, () => {
      for (const tempId of tempIds) optimistic.removePending(tempId);
    });
  }

  // SectionNav's own notion of "where am I" — it moves both when
  // SectionNav is clicked (jumpToSection, below) and whenever the
  // scroll-settle debounce below resolves to a different section (#54);
  // either way the URL is kept in sync with whichever one moved it last,
  // and either way it's a `section_navigated` (see handleSectionChangeFromScroll).
  const [currentSectionRef, setCurrentSectionRef] = useState<SectionRef | null>(
    initialSection,
  );
  const previousSection = currentSectionRef
    ? previousSectionRef(work.chapters, currentSectionRef)
    : null;
  const nextSection = currentSectionRef
    ? nextSectionRef(work.chapters, currentSectionRef)
    : null;

  const { reportSectionNavigated } = useSectionNavAnalytics(work);

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
            section: {
              chapterId: p.section.chapter.id,
              sectionId: p.section.id,
            },
          },
        ]),
      ),
    [structuralParagraphs],
  );

  const { progressPercent, timeLeft, visibleOrdinalRange } = useBookmarkTracker(
    {
      containerRef: readingColumnRef,
      workId: work.id,
      paragraphs: paragraphInfoById,
      totalParagraphs: structuralParagraphs.length,
      initialGlobalOrdinal: bookmarkGlobalOrdinal,
      initialProgressPercent,
      initialTimeLeft,
      onSectionChange: handleSectionChangeFromScroll,
    },
  );

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
    return {
      minGlobalOrdinal: Math.min(...ordinals),
      maxGlobalOrdinal: Math.max(...ordinals),
    };
  }, [structuralParagraphs, initialSection]);

  const marginaliaOrdinalRange =
    visibleOrdinalRange ?? initialSectionOrdinalRange;

  function jumpToSection(target: SectionRef) {
    const targetRowId = `divider:${target.sectionId}`;
    const targetIndex = rows.findIndex((row) => row.id === targetRowId);
    if (targetIndex >= 0 && targetIndex < loadedStartIndex) {
      // A deliberate jump backwards is exactly the case the forward-only
      // rule makes room for: the reader asked for this section, so load
      // back to it and land on it once it has rendered.
      pendingScrollRef.current = { id: targetRowId, offsetPx: 0 };
      setLoadedStartIndex(targetIndex);
    } else {
      scrollToRow(targetRowId);
    }
    const from = currentSectionRef;
    setCurrentSectionRef(target);
    // A plain history update, not a react-router navigation: the whole
    // work's paragraphs are already loaded client-side, so re-running the
    // loader over a ?section= change would only refetch data this page
    // already has, for no benefit beyond a URL that matches — pointless
    // network round trip and a scroll-position reset to boot.
    window.history.replaceState(
      null,
      "",
      `/read/${work.id}?section=${target.sectionId}`,
    );
    reportSectionNavigated(from, target);
  }

  // Deep-linking to a section needs no scroll at all any more. The row
  // list starts at that section, so the reader is already there at
  // scrollTop 0 — where previously this jumped potentially dozens of
  // chapters on nothing but height guesses and landed wherever those
  // guesses summed to.

  /**
   * Pulls the previous section in above what's loaded, without moving the
   * page under the reader.
   *
   * Prepending rows pushes everything below them down by however tall the
   * new ones turn out to be, which is unknowable in advance — so rather
   * than try to predict it, note which row the reader is on first and put
   * that row back where it was afterwards. `scrollToRow` finishes against
   * the row's real box, so the correction is exact even though the newly
   * prepended heights start out as guesses.
   */
  function loadPreviousSection() {
    pendingScrollRef.current = captureAnchor();
    setLoadedStartIndex(previousSectionStartIndex);
  }

  // Applied on the commit that has the new row list, before paint. Shared
  // by loadPreviousSection (restore the reader's own row) and a backwards
  // jumpToSection (land on the requested section).
  useLayoutEffect(() => {
    const pending = pendingScrollRef.current;
    if (!pending) return;
    pendingScrollRef.current = null;
    scrollToRow(pending.id, pending.offsetPx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedStartIndex]);

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
  const entries = deriveEntries(
    marginaliaSourceParagraphs,
    marginaliaOrdinalRange,
  );
  const highlights = deriveHighlights(
    marginaliaSourceParagraphs,
    marginaliaOrdinalRange,
  );

  // TokenComposer's pinned "in view" suggestion (#117 follow-up) — same
  // source paragraphs and range marginalia itself scopes to, so the token
  // always agrees with what the margin rail is currently showing as "here".
  const onScreenExcerpt = useMemo(
    () =>
      buildOnScreenExcerpt(marginaliaSourceParagraphs, marginaliaOrdinalRange),
    [marginaliaSourceParagraphs, marginaliaOrdinalRange],
  );

  const workMeta = { title: work.title, author: work.author };

  // What a selection's spans need to become a pill's locator — ordinal and
  // section.ordinal per paragraphId, the same fields highlightCreatedEvent's
  // server-side twin re-fetches for its own locator, already sitting in
  // structuralParagraphs since it's this route's loader data. Also what
  // pendingHighlightToDisplay/pendingEntryToDisplay use below, since a
  // pending item is never anchored to more than the handful of paragraphs
  // its own spans/anchor name.
  const paragraphLocatorById = useMemo(
    () =>
      new Map(
        structuralParagraphs.map((p) => [
          p.id,
          { ordinal: p.ordinal, section: { ordinal: p.section.ordinal } },
        ]),
      ),
    [structuralParagraphs],
  );

  // Text a pending highlight's spans slice into, keyed by paragraphId —
  // the same field deriveHighlights reads off marginaliaSourceParagraphs,
  // just indexed for point lookups since a pending highlight only ever
  // touches a few paragraphs, not all of them.
  const paragraphTextById = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(contentById).map(([id, p]) => [id, p.text]),
      ),
    [contentById],
  );
  const locatorFor = useCallback(
    (paragraphId: string) => paragraphLocatorById.get(paragraphId),
    [paragraphLocatorById],
  );

  // The sidebar's own lists, with whatever's still in flight appended —
  // see useOptimisticAnnotations and handleAnnotationSaved above. Appended
  // rather than merged in place: a pending item disappears the instant the
  // real one (already sorted into `entries`/`highlights` by paragraph
  // order) takes its place, so there's never a moment both exist at once
  // for list order to matter.
  const displayHighlights = useMemo(
    () => [
      ...highlights,
      ...optimistic.pendingHighlights.map((h) =>
        pendingHighlightToDisplay(h, paragraphTextById, locatorFor),
      ),
    ],
    [highlights, optimistic.pendingHighlights, paragraphTextById, locatorFor],
  );
  const displayEntries = useMemo(
    () => [
      ...entries,
      ...optimistic.pendingEntries.map((e) =>
        pendingEntryToDisplay(e, locatorFor),
      ),
    ],
    [entries, optimistic.pendingEntries, locatorFor],
  );

  // Merged into each paragraph's own `highlights` prop below, alongside
  // its real highlightSpans — a pending highlight renders with the same
  // "hand" styling a confirmed one gets (highlightClassName), so there's
  // no visible change when the real one takes over. Grouped by
  // paragraphId once here rather than filtering `pendingHighlights` per
  // row, since most rows touch none of them.
  const pendingHighlightRangesByParagraphId = useMemo(() => {
    const map: Record<string, HighlightRange[]> = {};
    for (const h of optimistic.pendingHighlights) {
      for (const span of h.spans) {
        (map[span.paragraphId] ??= []).push({
          id: h.tempId,
          start: span.start,
          end: span.end,
          className: highlightClassName("hand"),
          order: h.createdAt,
        });
      }
    }
    return map;
  }, [optimistic.pendingHighlights]);

  const {
    rigOpen,
    setRigOpen,
    rigMounted,
    rigContext,
    rigSeedPill,
    handleOpenRigFromSidebar,
    handleAskRigFromSelection,
  } = useRigLauncher({
    workId: work.id,
    workMeta,
    marginaliaSourceParagraphs,
    marginaliaOrdinalRange,
    paragraphLocatorById,
  });

  return (
    <div className="flex h-screen flex-col bg-surface">
      {rigMounted && (
        <Suspense fallback={null}>
          <RigLivePanel
            workId={work.id}
            workTitle={work.title}
            open={rigOpen}
            onClose={() => setRigOpen(false)}
            context={rigContext}
            onScreenExcerpt={onScreenExcerpt}
            seedPill={rigSeedPill}
          />
        </Suspense>
      )}

      <div className="flex min-h-0 flex-1 items-stretch px-5 py-5">
        <PageStack
          progress={progressPercent / 100}
          side="read"
          className="flex-none"
        />

        {/* The book-page frame: ReadingRail, the scrolling paragraph
            column, and MarginaliaSidebar all live inside one bordered
            page, edge to edge with the PageStacks flanking it — see the
            Figma read-page redesign (node 82:348 in the design system
            file) this replaced ReaderHeader's top bar with. */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden border-2 border-divider-strong bg-bg">
          {/* Spans the whole book-page frame (ReadingRail through
              MarginaliaSidebar), not just the scrollable column — ReadingRail
              is what actually abuts each PageStack now (ReaderHeader's old
              top bar no longer separates them), so the hairline has to run
              the frame's full width to still read as the page lifting off
              the stack at both ends. See organic.css's `.page-edge` comment
              for the fade math this depends on. */}
          <div
            aria-hidden
            className="page-edge pointer-events-none absolute inset-x-0 top-0 z-10 h-[2px]"
          />
          <ReadingRail
            workTitle={work.title}
            progressPercent={progressPercent}
            timeLeft={timeLeft}
            onPreviousSection={
              previousSection ? () => jumpToSection(previousSection) : null
            }
            onNextSection={
              nextSection ? () => jumpToSection(nextSection) : null
            }
          />

          <SelectionHighlighter
            onAskRig={handleAskRigFromSelection}
            onSaved={handleAnnotationSaved}
            optimistic={optimistic}
          >
            {/* Positioned against SelectionHighlighter's own (non-scrolling)
                wrapper, not the scrollable column — staying inside the
                scrollable column would make this an absolutely positioned
                descendant of an overflow:auto element, which scrolls away
                with that element's own content instead of staying pinned to
                the reading pane. Scoped to the paragraph column alone,
                unlike `.page-edge` above: the grain textures the page's
                readable surface, not the rail/sidebar chrome flanking it.
                See organic.css's `.paper-grain` comment. */}
            <div
              aria-hidden
              className="paper-grain pointer-events-none absolute inset-0"
            />
            <div
              ref={readingColumnRef}
              className="min-w-0 flex-1 overflow-y-auto bg-bg px-16 pt-12"
            >
              <div ref={readingMeasureRef} className="mx-auto max-w-reading">
                {/* Only when the reader came in mid-book. Reading forward
                    never needs what's above, so it isn't loaded — but it's
                    still there, and this is how you say so. Sits above the
                    spacer rather than inside the virtualized list because
                    its height is constant and never enters the row math. */}
                {loadedStartIndex > 0 && (
                  <div className="mb-6 flex justify-center">
                    <button
                      type="button"
                      onClick={loadPreviousSection}
                      className="rounded border border-divider px-3 py-1.5 text-[12px] uppercase tracking-wide text-[var(--color-accent)] hover:bg-accent-100"
                    >
                      Load previous section
                    </button>
                  </div>
                )}
                {/* Spacers stand in for every unmounted row's combined height so
                    scroll height (and the scrollbar's own proportions) stay
                    correct without the whole book existing as real DOM nodes. */}
                <div style={{ height: topSpacerHeight }} />
                {visibleRows.slice(startIndex, endIndex).map((row) => {
                  if (row.type === "divider") {
                    return (
                      <ChapterSectionDivider
                        key={row.id}
                        id={row.id}
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
                    return (
                      <ReadingParagraphSkeleton
                        key={row.id}
                        id={row.id}
                        heightPx={estimateParagraphHeightPx(
                          row.structural.wordCount,
                          readingColumnWidth,
                        )}
                        ref={registerRowRef(row.id)}
                      />
                    );
                  }
                  return (
                    <ReadingParagraph
                      key={row.id}
                      ref={registerRowRef(row.id)}
                      paragraph={paragraph}
                      isFirstInSection={row.structural.ordinal === 1}
                      highlights={[
                        ...paragraph.highlightSpans.map((s) => ({
                          id: s.highlight.id,
                          start: s.startOffset,
                          end: s.endOffset,
                          className: highlightClassName(s.highlight.role),
                          order: s.highlight.createdAt.getTime(),
                        })),
                        ...(pendingHighlightRangesByParagraphId[row.id] ?? []),
                      ]}
                    />
                  );
                })}
                <div style={{ height: bottomSpacerHeight }} />
                {structuralParagraphs.length === 0 && (
                  <p className="text-sm opacity-50">
                    This work has no ingested text yet.
                  </p>
                )}
              </div>
            </div>
          </SelectionHighlighter>

          <MarginaliaSidebar
            workId={work.id}
            entries={displayEntries}
            highlights={displayHighlights}
            onSaved={handleAnnotationSaved}
            optimistic={optimistic}
            onOpenRig={handleOpenRigFromSidebar}
          />
        </div>

        <PageStack
          progress={progressPercent / 100}
          side="toGo"
          className="flex-none"
        />
      </div>
    </div>
  );
}
