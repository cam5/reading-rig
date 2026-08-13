import { useCallback, useEffect, useRef, useState } from "react";
import {
  computeVirtualWindow,
  type VirtualWindow,
} from "~/domain/reading/virtualWindow";

type Params = {
  /** The scrollable container these rows live inside — the same element `useBookmarkTracker` attaches its own listener to. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Every row's stable id, in render order. A new array (a different work loaded) resets every cached measurement. */
  rowIds: string[];
  /** A height guess per row, parallel to `rowIds`, used until each row has actually been measured — never precise, just enough that the very first paint windows correctly instead of mounting everything. */
  initialHeights: number[];
  /** A row id to center the very first server-rendered window on, instead
   * of the top of the work — read.tsx passes the landing section's own
   * divider row for a `?section=` deep link. Without this the initial
   * mount always windows around index 0 regardless of where the reader's
   * actually landing, which used to be harmless (every paragraph's
   * content was already in memory everywhere) but isn't once content is
   * fetched in a window centered on that same anchor — the SSR-mounted
   * rows have to agree with what's actually loaded, or a mid-book deep
   * link mounts rows with no content to render. */
  initialAnchorRowId?: string;
  /** How far past the viewport, in px, to keep rows mounted on each side. Default 1000. Generous on purpose: per the ticket, this is the only thing standing between a live text selection and its target row unmounting mid-drag — a completed highlight is a `HighlightSpan` row, not DOM state, so it re-renders fine whenever its paragraph remounts, but a selection still being dragged when a row disappears is at risk, and dragging one further than this without releasing the mouse isn't a real gesture. */
  overscanPx?: number;
};

type Result = VirtualWindow & {
  /** A ref callback for row `id` — measures it on mount and on every resize, keeping the window in sync. Memoized per id, so passing a fresh string each render doesn't force React to re-run the ref. */
  registerRowRef: (
    id: string,
  ) => (el: HTMLElement | null) => (() => void) | void;
  /** Jumps the container's scroll position straight to row `id`, using whatever heights are currently known (real or estimated) — approximate until nearby rows have actually been measured, self-correcting as the reader scrolls past. */
  scrollToRow: (id: string) => void;
};

const DEFAULT_OVERSCAN_PX = 1000;

/**
 * `getBoundingClientRect()` excludes margin — a row's own bottom margin
 * (e.g. a chapter/section divider's) is real vertical space it occupies in
 * the scroll, so it has to be added back by hand for the spacer math to
 * come out right. Get this wrong and a couple thousand rows' worth of
 * missing margin breaks the scrollbar outright, not just the row that's
 * short by a few px.
 */
function occupiedHeight(el: HTMLElement): number {
  const marginBottom = parseFloat(getComputedStyle(el).marginBottom || "0");
  return el.getBoundingClientRect().height + marginBottom;
}

/** Sum of every row's height strictly before `index` — the scroll offset
 * `index` itself starts at, using whatever heights are currently known
 * (real or estimated). Shared by `scrollToRow` (a live jump) and the
 * initial window's lazy `useState` (seeding where the very first render
 * already sits, before there's a container to set `scrollTop` on). */
function offsetOfIndex(heights: number[], index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i++) offset += heights[i] ?? 0;
  return offset;
}

/**
 * The DOM half of the continuous reader: given a flat list of rows (in
 * practice, chapter/section dividers interleaved with paragraphs), decides
 * which ones are actually mounted and hands back spacer heights for the
 * rest — `computeVirtualWindow`'s pure math, wired to a real scroll
 * container and a `ResizeObserver` that corrects each row's height guess
 * once it's actually rendered.
 */
export function useVirtualizedRows({
  containerRef,
  rowIds,
  initialHeights,
  initialAnchorRowId,
  overscanPx = DEFAULT_OVERSCAN_PX,
}: Params): Result {
  const rowIdsRef = useRef<string[] | null>(null);
  const heightsRef = useRef<number[]>([]);
  const indexByIdRef = useRef<Map<string, number>>(new Map());

  // Rebuilt synchronously during render, not in an effect. registerRowRef's
  // ref callbacks fire while React commits *this* render's DOM — before any
  // of this hook's own effects run — so indexByIdRef and heightsRef have to
  // already be correct by then, or the very first paint's rows are measured
  // against the previous work's (or no) index map at all.
  if (rowIdsRef.current !== rowIds) {
    rowIdsRef.current = rowIds;
    indexByIdRef.current = new Map(rowIds.map((id, i) => [id, i]));
    heightsRef.current = initialHeights.slice();
  }

  const elementIndexRef = useRef<Map<Element, number>>(new Map());
  const refCallbacksRef = useRef<
    Map<string, (el: HTMLElement | null) => (() => void) | void>
  >(new Map());

  // Lazy initializer — runs once, on mount, after the rowIdsRef reset
  // above has already run in this same render, so indexByIdRef/heightsRef
  // are current by the time this reads them.
  const [win, setWin] = useState<VirtualWindow>(() => {
    const anchorIndex = initialAnchorRowId
      ? indexByIdRef.current.get(initialAnchorRowId)
      : undefined;
    const initialScrollTop =
      anchorIndex === undefined
        ? 0
        : offsetOfIndex(heightsRef.current, anchorIndex);
    return computeVirtualWindow(
      heightsRef.current,
      initialScrollTop,
      0,
      overscanPx,
    );
  });

  const recompute = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    setWin((prev) => {
      const next = computeVirtualWindow(
        heightsRef.current,
        container.scrollTop,
        container.clientHeight,
        overscanPx,
      );
      return prev.startIndex === next.startIndex &&
        prev.endIndex === next.endIndex &&
        prev.topSpacerHeight === next.topSpacerHeight &&
        prev.bottomSpacerHeight === next.bottomSpacerHeight
        ? prev
        : next;
    });
  }, [containerRef, overscanPx]);

  // registerRowRef's cached callbacks and the ResizeObserver below both
  // need the *current* recompute, not whichever one existed when they were
  // first created — a ref, not a closure, sidesteps that staleness rather
  // than relying on dependency arrays being exhaustive everywhere they're used.
  const recomputeRef = useRef(recompute);
  recomputeRef.current = recompute;

  // Created synchronously during render (a lazy ref-init, the same pattern
  // as `useState(() => ...)`), not in an effect — for the same reason as
  // indexByIdRef above: the first batch of ref callbacks fires before any
  // effect runs, and they need a live observer to register with, not one
  // that shows up a tick later.
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  // This render body runs during SSR too, where `ResizeObserver` doesn't
  // exist at all (it's a browser global, not a Node one) — the guard makes
  // SSR a no-op here rather than crashing the whole render. Ref callbacks
  // never fire server-side anyway, so nothing needs the observer until the
  // client's own first render, where the global is real.
  if (
    resizeObserverRef.current === null &&
    typeof ResizeObserver !== "undefined"
  ) {
    resizeObserverRef.current = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const index = elementIndexRef.current.get(entry.target);
        if (index === undefined) continue;
        const height = occupiedHeight(entry.target as HTMLElement);
        if (heightsRef.current[index] !== height) {
          heightsRef.current[index] = height;
          changed = true;
        }
      }
      if (changed) recomputeRef.current();
    });
  }

  useEffect(() => {
    const observer = resizeObserverRef.current;
    return () => observer?.disconnect();
  }, []);

  // A new row list changes what heightsRef actually holds (reset above,
  // synchronously) — the mounted window itself still needs recomputing
  // against those fresh heights once React's committed the reset.
  useEffect(() => {
    recompute();
  }, [rowIds, recompute]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let frame: number | null = null;
    function onScroll() {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        recomputeRef.current();
      });
    }

    container.addEventListener("scroll", onScroll, { passive: true });
    recompute(); // seed against the container's real clientHeight once it exists
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [containerRef, recompute]);

  function registerRowRef(id: string) {
    let callback = refCallbacksRef.current.get(id);
    if (!callback) {
      callback = (el: HTMLElement | null) => {
        if (!el) return;
        const index = indexByIdRef.current.get(id);
        if (index === undefined) return;
        elementIndexRef.current.set(el, index);
        heightsRef.current[index] = occupiedHeight(el);
        resizeObserverRef.current?.observe(el);
        return () => {
          elementIndexRef.current.delete(el);
          resizeObserverRef.current?.unobserve(el);
        };
      };
      refCallbacksRef.current.set(id, callback);
    }
    return callback;
  }

  function scrollToRow(id: string) {
    const container = containerRef.current;
    const index = indexByIdRef.current.get(id);
    if (!container || index === undefined) return;
    container.scrollTop = offsetOfIndex(heightsRef.current, index);
    recompute();
  }

  return { ...win, registerRowRef, scrollToRow };
}
