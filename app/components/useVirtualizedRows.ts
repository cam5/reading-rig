import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  computeVirtualWindow,
  rowIndexAtOffset,
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

/** A row, and where in the viewport it was sitting — enough to put the
 * reader back exactly where they were after the row list changes shape
 * underneath them. */
export type ScrollAnchor = {
  id: string;
  /** Distance from the reading column's top edge to the row's own top.
   * Usually negative: the row the reader's eye is on has normally started
   * above the fold. */
  offsetPx: number;
};

type Result = VirtualWindow & {
  /** A ref callback for row `id` — measures it on mount and on every resize, keeping the window in sync. Memoized per id, so passing a fresh string each render doesn't force React to re-run the ref. */
  registerRowRef: (
    id: string,
  ) => (el: HTMLElement | null) => (() => void) | void;
  /** Scrolls row `id` to `offsetPx` from the column's top edge (0 — flush
   * with the top — by default). Jumps using whatever heights are currently
   * known, then corrects against the row's real box once it's mounted, so
   * the landing is exact rather than as good as the estimates were. */
  scrollToRow: (id: string, offsetPx?: number) => void;
  /** The row the reader is currently looking at, and where it sits. Pair
   * with `scrollToRow` across a change to the row list — prepending rows
   * shifts every offset below them, and this is what makes that shift
   * invisible. */
  captureAnchor: () => ScrollAnchor | null;
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
  const initialHeightsRef = useRef<number[] | null>(null);
  // The row the reader was on when a re-estimate invalidated every offset,
  // waiting to be scrolled back to under the new heights.
  const reanchorIndexRef = useRef<number | null>(null);
  if (rowIdsRef.current !== rowIds) {
    rowIdsRef.current = rowIds;
    indexByIdRef.current = new Map(rowIds.map((id, i) => [id, i]));
    heightsRef.current = initialHeights.slice();
    initialHeightsRef.current = initialHeights;
  } else if (initialHeightsRef.current !== initialHeights) {
    // Same rows, new guesses — the caller re-estimated because the reading
    // column changed width (a resize, or the first client measurement
    // replacing the server's assumed width). Every height in the table is
    // stale, measured ones included: a paragraph that really was 4 lines
    // at 660px is a different number of lines at 380px. Re-seed the lot
    // and let the ResizeObserver correct whatever is currently mounted,
    // which it does in the same resize pass — a table half in old-width
    // measurements and half in new-width estimates would describe a column
    // that never existed.
    //
    // Rewriting every height also moves every scroll offset, so note which
    // row the reader is on *before* the old numbers are gone. Restoring by
    // row rather than by pixel is the only thing that means anything here:
    // the pixel they were at describes a column that no longer exists.
    const container = containerRef.current;
    reanchorIndexRef.current = container
      ? rowIndexAtOffset(heightsRef.current, container.scrollTop)
      : null;
    initialHeightsRef.current = initialHeights;
    heightsRef.current = initialHeights.slice();
  }

  const elementIndexRef = useRef<Map<Element, number>>(new Map());
  // The reverse lookup scrollToRow needs to finish a jump against a row's
  // real, measured position rather than a sum of guesses.
  const elementByIdRef = useRef<Map<string, HTMLElement>>(new Map());
  // A jump whose target had not mounted yet, waiting for the commit that
  // mounts it. Never more than one outstanding — a second jump supersedes
  // the first, which is what a reader clicking two sections in a row means.
  const pendingScrollTargetRef = useRef<ScrollAnchor | null>(null);
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

  /**
   * Records freshly measured heights, keeping whatever row the reader is
   * actually looking at visually fixed.
   *
   * A row's height changing is not a scroll, but it moves the page as if
   * it were: every row above the fold contributes to `topSpacerHeight`, so
   * replacing one of their guesses with a real measurement slides
   * everything below it under a `scrollTop` that never moved. Nothing used
   * to cancel that, and the asymmetry it produced was stark — measured on
   * 2f6a321, scrolling *up* through never-measured rows displaced the
   * column by 6,211px over ~220 frames (single frames jumping as much as
   * 552px, two thirds of the viewport), while scrolling *down* over the
   * same distance measured exactly 0, because corrections there land in
   * the bottom spacer, which nothing is anchored to. Readers scrolling
   * back to re-read a sentence got roughly half their scroll input eaten
   * by the page fighting them.
   *
   * Adding the same delta back to `scrollTop` cancels it exactly. Only
   * rows *above* the anchor count: a correction at or below it changes
   * what's under the reader's eye, not where it sits. Both call sites run
   * before paint — a ref callback during React's commit, a
   * `ResizeObserver` callback at the end of layout — so the compensation
   * lands in the same frame as the shift it undoes, with nothing rendered
   * in between.
   */
  const applyMeasuredHeights = useCallback(
    (measurements: { index: number; height: number }[]): boolean => {
      const heights = heightsRef.current;
      const container = containerRef.current;
      // Resolved once, against the pre-correction heights, so every
      // measurement in a batch is judged above-or-below the same row.
      const anchorIndex = container
        ? rowIndexAtOffset(heights, container.scrollTop)
        : 0;
      let changed = false;
      let driftAboveAnchor = 0;
      for (const { index, height } of measurements) {
        const previous = heights[index] ?? 0;
        if (previous === height) continue;
        if (index < anchorIndex) driftAboveAnchor += height - previous;
        heights[index] = height;
        changed = true;
      }
      if (driftAboveAnchor !== 0 && container) {
        container.scrollTop += driftAboveAnchor;
      }
      return changed;
    },
    [containerRef],
  );

  const applyMeasuredHeightsRef = useRef(applyMeasuredHeights);
  applyMeasuredHeightsRef.current = applyMeasuredHeights;

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
      const measurements: { index: number; height: number }[] = [];
      for (const entry of entries) {
        const index = elementIndexRef.current.get(entry.target);
        if (index === undefined) continue;
        measurements.push({
          index,
          height: occupiedHeight(entry.target as HTMLElement),
        });
      }
      // One batched call, not one per entry — a single anchor row for the
      // whole batch, and a single `scrollTop` write to correct against it.
      if (applyMeasuredHeightsRef.current(measurements)) {
        recomputeRef.current();
      }
    });
  }

  useEffect(() => {
    const observer = resizeObserverRef.current;
    return () => observer?.disconnect();
  }, []);

  // A new row list — or a re-estimate at a new column width — changes what
  // heightsRef actually holds (reset above, synchronously). The mounted
  // window itself still needs recomputing against those fresh heights once
  // React's committed the reset.
  useEffect(() => {
    recompute();
  }, [rowIds, initialHeights, recompute]);

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

  /**
   * Finishes a `scrollToRow` jump against the target's *real* position.
   *
   * The jump itself is a sum of height guesses, and a few hundred of them
   * do not add up to exactly the right place — a section deep link landing
   * ~52px high was enough to leave the previous section's last line at the
   * top of the viewport, which is then what the URL and SectionNav
   * reported the reader as being in. Once the row is mounted its position
   * is no longer a guess but a real box, so the remaining gap can simply
   * be measured and closed.
   *
   * Returns whether the target was mounted, so the caller knows whether to
   * try again on the commit that mounts it. Idempotent: a second pass
   * measures a delta of zero and does nothing.
   */
  function settleScrollTarget({ id, offsetPx }: ScrollAnchor): boolean {
    const container = containerRef.current;
    const element = elementByIdRef.current.get(id);
    if (!container || !element) return false;
    const delta =
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      offsetPx;
    if (Math.abs(delta) >= 0.5) {
      container.scrollTop += delta;
      recomputeRef.current();
    }
    return true;
  }

  // Runs after every commit on purpose (no dependency array): the commit
  // that matters is whichever one first mounts the jump's target row, and
  // that is not knowable from a dependency list. Runs before paint, so the
  // reader never sees the approximate landing.
  useLayoutEffect(() => {
    // A re-estimate takes precedence: it invalidated the offsets a pending
    // jump would otherwise be measuring itself against.
    const reanchorIndex = reanchorIndexRef.current;
    if (reanchorIndex !== null) {
      reanchorIndexRef.current = null;
      const container = containerRef.current;
      if (container) {
        container.scrollTop = offsetOfIndex(heightsRef.current, reanchorIndex);
        recomputeRef.current();
      }
    }
    const pending = pendingScrollTargetRef.current;
    if (pending === null) return;
    if (settleScrollTarget(pending)) pendingScrollTargetRef.current = null;
  });

  function registerRowRef(id: string) {
    let callback = refCallbacksRef.current.get(id);
    if (!callback) {
      callback = (el: HTMLElement | null) => {
        if (!el) return;
        const index = indexByIdRef.current.get(id);
        if (index === undefined) return;
        elementIndexRef.current.set(el, index);
        elementByIdRef.current.set(id, el);
        // A row's very first measurement is the largest correction it will
        // ever contribute (a guess replaced by the real thing), so it needs
        // the same anchor compensation the ResizeObserver gets — this fires
        // during commit, before the browser has painted the row.
        applyMeasuredHeightsRef.current([
          { index, height: occupiedHeight(el) },
        ]);
        resizeObserverRef.current?.observe(el);
        return () => {
          elementIndexRef.current.delete(el);
          // Only if this id still points at *this* element — React can
          // mount the replacement before detaching the old one.
          if (elementByIdRef.current.get(id) === el) {
            elementByIdRef.current.delete(id);
          }
          resizeObserverRef.current?.unobserve(el);
        };
      };
      refCallbacksRef.current.set(id, callback);
    }
    return callback;
  }

  function scrollToRow(id: string, offsetPx = 0) {
    const container = containerRef.current;
    const index = indexByIdRef.current.get(id);
    if (!container || index === undefined) return;
    container.scrollTop = offsetOfIndex(heightsRef.current, index) - offsetPx;
    recompute();
    // If the row is already mounted this lands now; if the recompute above
    // is what mounts it, the layout effect picks it up on that commit.
    if (!settleScrollTarget({ id, offsetPx })) {
      pendingScrollTargetRef.current = { id, offsetPx };
    }
  }

  /**
   * Where the reader is, in terms that survive the row list changing.
   *
   * A scroll offset does not survive it: prepending a section's worth of
   * rows moves every offset below them by however tall that section turns
   * out to be. A row id plus its position in the viewport does survive,
   * because it names the thing the reader is actually looking at rather
   * than a coordinate that only meant something under the old list.
   */
  function captureAnchor(): ScrollAnchor | null {
    const container = containerRef.current;
    const ids = rowIdsRef.current;
    if (!container || !ids) return null;
    const id = ids[rowIndexAtOffset(heightsRef.current, container.scrollTop)];
    if (id === undefined) return null;
    const element = elementByIdRef.current.get(id);
    return {
      id,
      offsetPx: element
        ? element.getBoundingClientRect().top -
          container.getBoundingClientRect().top
        : 0,
    };
  }

  return { ...win, registerRowRef, scrollToRow, captureAnchor };
}
