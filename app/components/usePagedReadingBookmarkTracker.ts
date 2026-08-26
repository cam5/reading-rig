import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { VisibleItem } from "../../lib/paged-columns";
import {
  resolveBookmarkFromCandidates,
  type BookmarkTrackerResult,
  type ParagraphInfo,
} from "./useBookmarkTracker";
import type { ScrollCandidate } from "~/domain/reading/scrollPosition";
import type { SectionRef } from "~/domain/reading/sectionNavigation";

type Params = {
  workId: string;
  paragraphs: Record<string, ParagraphInfo>;
  totalParagraphs: number;
  initialGlobalOrdinal: number;
  initialProgressPercent: number;
  initialTimeLeft: string;
  onSectionChange: (section: SectionRef) => void;
  /** `usePagedColumns`' own `visibleItems` — real, measured fragments on
   * whichever page is currently displayed. */
  visibleItems: VisibleItem[];
  /** `usePagedColumns`' own `pageKey` — the trigger. A page turn is
   * already one settled event in its own right, unlike a scroll's
   * continuous stream, so there's nothing here worth debouncing the way
   * `useBookmarkTracker` debounces a scroll. */
  pageKey: string;
};

/**
 * `useBookmarkTracker`'s paged-mode twin. Reuses its shared
 * `resolveBookmarkFromCandidates` for the actual bookmark/section/
 * progress/visibleOrdinalRange logic — see that function's own doc
 * comment for why paged mode can't reuse `useBookmarkTracker`'s
 * `querySelectorAll` DOM scan wholesale: a CSS multi-column frame clips
 * *visually*, not structurally, so every fragment of every mounted
 * paragraph — on the current page and every other mounted one — is
 * equally reachable by `querySelectorAll`. `usePagedColumns` already had
 * to solve exactly this problem to answer its own "what's on the current
 * page" question (it measures each fragment's real column position, not
 * just whether it's inside some container), so this hook takes that
 * answer (`visibleItems`) instead of re-deriving it via a second, wrong
 * DOM query.
 *
 * A `VisibleItem`'s own `topPx`/`bottomPx` are already relative to the
 * *frame's* top edge (see `usePagedColumns`' own doc comment on why
 * that's valid regardless of which page is currently showing) — exactly
 * the coordinate space `pickCurrentSectionParagraph`/`pickCurrentParagraph`
 * already expect, so no translation happens here beyond the id→ordinal
 * lookup every `ScrollCandidate` needs.
 */
export function usePagedReadingBookmarkTracker({
  workId,
  paragraphs,
  totalParagraphs,
  initialGlobalOrdinal,
  initialProgressPercent,
  initialTimeLeft,
  onSectionChange,
  visibleItems,
  pageKey,
}: Params): BookmarkTrackerResult {
  const fetcher = useFetcher();
  const knownGlobalOrdinal = useRef(initialGlobalOrdinal);
  const [progress, setProgress] = useState<BookmarkTrackerResult>({
    progressPercent: initialProgressPercent,
    timeLeft: initialTimeLeft,
    visibleOrdinalRange: null,
  });

  useEffect(() => {
    knownGlobalOrdinal.current = initialGlobalOrdinal;
  }, [initialGlobalOrdinal]);

  // Same staleness reasoning as useBookmarkTracker's own latestRef: a page
  // turn's effect can in principle run after a render that changed these.
  const latestRef = useRef({
    workId,
    paragraphs,
    totalParagraphs,
    onSectionChange,
    visibleItems,
    fetcher,
  });
  latestRef.current = {
    workId,
    paragraphs,
    totalParagraphs,
    onSectionChange,
    visibleItems,
    fetcher,
  };

  useEffect(() => {
    const {
      workId,
      paragraphs,
      totalParagraphs,
      onSectionChange,
      visibleItems,
      fetcher,
    } = latestRef.current;

    const candidates: ScrollCandidate[] = [];
    for (const item of visibleItems) {
      const info = paragraphs[item.id];
      if (!info) continue;
      candidates.push({
        id: item.id,
        globalOrdinal: info.globalOrdinal,
        topOffsetPx: item.topPx,
        bottomOffsetPx: item.bottomPx,
      });
    }

    setProgress(
      resolveBookmarkFromCandidates({
        candidates,
        // usePagedColumns already did the "is this on the current page"
        // filtering (a real measured column-index match, not a height
        // guess) before handing back visibleItems — every candidate here
        // is already known to belong on screen, so
        // pickCurrentSectionParagraph's own height bound has nothing left
        // to exclude. Infinity says so explicitly rather than reusing an
        // arbitrary generous number.
        viewportHeightPx: Number.POSITIVE_INFINITY,
        workId,
        paragraphs,
        totalParagraphs,
        knownGlobalOrdinalRef: knownGlobalOrdinal,
        onSectionChange,
        fetcher,
      }),
    );
    // pageKey is the real trigger — visibleItems is read through the ref
    // above for the same staleness reason as useBookmarkTracker's own
    // latestRef pattern, not as a reactive dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);

  return progress;
}
