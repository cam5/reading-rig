import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { computeReadingProgress, type ProgressParagraph } from "~/domain/reading/readingProgress";
import {
  computeVisibleOrdinalRange,
  pickCurrentParagraph,
  type OrdinalRange,
  type ScrollCandidate,
} from "~/domain/reading/scrollPosition";
import type { SectionRef } from "~/domain/reading/sectionNavigation";

/** A paragraph just above the reading column's own top edge still counts
 * as "read"/"here" — a small threshold, not the exact pixel, so a
 * paragraph just barely crossing the line still counts. */
const READ_THRESHOLD_PX = 40;

/** How long to wait after the most recent scroll event before acting on
 * wherever it settled — a few hundred ms, per the ticket (#54). Both the
 * exact value and whether URL/bookmark/progress would ever need separate
 * debounces are explicitly undecided there; one shared timer driving all
 * three is the simplest thing that satisfies it. */
const SCROLL_SETTLE_DEBOUNCE_MS = 400;

type ParagraphInfo = ProgressParagraph & { section: SectionRef };

type Params = {
  /** The scrollable reading column — the element the scroll listener
   * attaches to and whose children are searched for `[data-paragraph-id]`. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** The work these paragraphs belong to — used to build the `?section=`
   * URL the same way `SectionNav`'s own click-driven jump does. */
  workId: string;
  paragraphs: Record<string, ParagraphInfo>;
  /** The bookmark's current globalOrdinal, if one exists yet — from the
   * loader, so a fresh page load doesn't need to scroll before it knows
   * where "not past" starts. */
  initialGlobalOrdinal: number;
  /** The whole work's paragraph count — the denominator `progressPercent`
   * is computed against. */
  totalParagraphs: number;
  /** The loader's own `progressPercent`/`timeLeft`, computed once against
   * the full page load — the starting readout, before any scroll has
   * happened to recompute it client-side. */
  initialProgressPercent: number;
  initialTimeLeft: string;
  /** Called with wherever the scroll settled's nearest section, once per
   * debounce — not clamped monotonic like the bookmark, since scrolling
   * back up should move this (and SectionNav's prev/next targets) back
   * with it. */
  onSectionChange: (section: SectionRef) => void;
};

type Result = {
  progressPercent: number;
  timeLeft: string;
  /** The globalOrdinal span of whatever's currently virtualized into the
   * DOM, recomputed on the same scroll-settle debounce as everything else
   * here — marginalia (#55, phase 4 of #51) filters to entries/
   * highlights anchored inside it, the same way `progressPercent`/
   * `timeLeft` follow the bookmark. `null` until the first debounce fires;
   * callers fall back to something else (e.g. the section the reader
   * landed on) for that brief initial window. */
  visibleOrdinalRange: OrdinalRange | null;
};

/**
 * Writes the reading position on scroll: the furthest paragraph whose top
 * has scrolled above the reading column's own top edge. Monotonic by
 * construction — scrolling back up to re-read something earlier never
 * moves the bookmark backward, since it only ever submits when the
 * furthest-read ordinal exceeds what's already known.
 *
 * Also drives the URL's `?section=` param and the progress/time-left
 * readout (#54, phase 3 of #51) — both recomputed from wherever the
 * scroll settles, on the same debounce as the bookmark resubmit, rather
 * than per-frame. The DOM is only actually queried once the debounce
 * fires, not on every scroll event.
 *
 * That same per-settle DOM query also hands back marginalia's scope
 * (#55, phase 4 of #51): the full span of globalOrdinals among every
 * paragraph currently mounted, not just the ones `pickCurrentParagraph`
 * picks between. Reusing this debounce — rather than the `useVirtualizedRows`
 * rAF listener that drives the window's own mount/unmount — means marginalia
 * updates once scrolling settles, the same cadence as everything else here,
 * not once per animation frame.
 */
export function useBookmarkTracker({
  containerRef,
  workId,
  paragraphs,
  initialGlobalOrdinal,
  totalParagraphs,
  initialProgressPercent,
  initialTimeLeft,
  onSectionChange,
}: Params): Result {
  const fetcher = useFetcher();
  const knownGlobalOrdinal = useRef(initialGlobalOrdinal);
  const [progress, setProgress] = useState<Result>({
    progressPercent: initialProgressPercent,
    timeLeft: initialTimeLeft,
    visibleOrdinalRange: null,
  });

  useEffect(() => {
    knownGlobalOrdinal.current = initialGlobalOrdinal;
  }, [initialGlobalOrdinal]);

  // The debounce timer set inside the effect below can fire after a render
  // that changed these — read through a ref rather than the hook's own
  // closed-over params, so a timer that's mid-flight when new props land
  // still acts on the latest data, not whatever was current when it was set.
  const latestRef = useRef({ workId, paragraphs, totalParagraphs, onSectionChange, fetcher });
  latestRef.current = { workId, paragraphs, totalParagraphs, onSectionChange, fetcher };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    function settle() {
      debounceTimer = null;
      const current = containerRef.current;
      if (!current) return;
      const { workId, paragraphs, totalParagraphs, onSectionChange, fetcher } = latestRef.current;

      const containerTop = current.getBoundingClientRect().top;
      const candidates: ScrollCandidate[] = [];
      for (const el of current.querySelectorAll<HTMLElement>("[data-paragraph-id]")) {
        const id = el.dataset.paragraphId;
        const info = id ? paragraphs[id] : undefined;
        if (id && info) {
          candidates.push({ id, globalOrdinal: info.globalOrdinal, topOffsetPx: el.getBoundingClientRect().top - containerTop });
        }
      }

      const nearest = pickCurrentParagraph(candidates, READ_THRESHOLD_PX);
      if (nearest) {
        const info = paragraphs[nearest.id];
        if (info) {
          onSectionChange(info.section);
          // A plain history update, not a react-router navigation — same
          // reasoning as SectionNav's own click-driven jump: the whole
          // work's paragraphs are already loaded client-side, so
          // re-running the loader over a ?section= change would only
          // refetch data this page already has, and would reset scroll
          // position to boot.
          window.history.replaceState(null, "", `/read/${workId}?section=${info.section.sectionId}`);

          if (nearest.globalOrdinal > knownGlobalOrdinal.current) {
            knownGlobalOrdinal.current = nearest.globalOrdinal;
            fetcher.submit({ intent: "bookmark", paragraphId: nearest.id }, { method: "post" });
          }
        }
      }

      // Set regardless of whether anything crossed the read threshold above
      // — marginalia's scope (visibleOrdinalRange) follows the mounted
      // window itself, not "has been read", and progressPercent/timeLeft
      // are cheap to recompute even when knownGlobalOrdinal didn't move.
      setProgress({
        ...computeReadingProgress(Object.values(paragraphs), totalParagraphs, knownGlobalOrdinal.current),
        visibleOrdinalRange: computeVisibleOrdinalRange(candidates),
      });
    }

    function handleScroll() {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(settle, SCROLL_SETTLE_DEBOUNCE_MS);
    }

    // A section (or a whole short work) that fits entirely within the
    // viewport never fires a native `scroll` event at all — nothing ever
    // arms the debounce above, so without this, `settle` would never run
    // and progress/bookmark/margin-rail would stay frozen at the loader's
    // initial values for the rest of the visit (#57). One direct,
    // undebounced call right after mount covers exactly that case; the
    // virtualized window already mounts every row a short work has (see
    // computeVirtualWindow's all-content-fits branch), so this sees the
    // same DOM a real scroll settle would. Every later update still goes
    // through the normal debounced path above.
    settle();

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (debounceTimer !== null) clearTimeout(debounceTimer);
    };
  }, [containerRef]);

  return progress;
}
