import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  columnIndexForOffset,
  estimateMountWindow,
  growMountWindow,
  type MountWindow,
} from "../columnMath";

export type PagedColumnsItem = {
  id: string;
  /** About how tall this item will render, in px — spent only on sizing
   * the mount window before real layout exists to measure against
   * (estimateMountWindow/growMountWindow). Never trusted for where a page
   * boundary actually falls; see the package README. */
  estimatedSizePx: number;
};

/** One fragment of one mounted item that the browser actually put on the
 * currently displayed page, as of the last measurement pass. `topPx`/
 * `bottomPx` are relative to the frame's own top edge — real, not
 * estimated, and valid regardless of which page is showing (a CSS
 * `translateX` never moves anything vertically, so these never need the
 * "cancel the transform out" trick `columnIndexForOffset`'s caller uses
 * for the horizontal axis). */
export type VisibleItem = {
  id: string;
  topPx: number;
  bottomPx: number;
};

type Params = {
  /** A non-scrolling sizing element the frame lives inside — typically a
   * `flex-1` box alongside a nav-controls row in the same flex column.
   * This hook only ever *reads* its height (via ResizeObserver); it's the
   * caller's job to make sure nothing this hook renders feeds back into
   * what that height resolves to, or the measurement chases its own
   * tail. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** One page's content width, in px — measured by the caller (it's
   * usually already tracking this for its own text-measure purposes, so
   * this package doesn't duplicate that ResizeObserver). */
  columnWidthPx: number;
  /** Gap between adjacent columns, in px. 0 is a legitimate choice — full
   * bleed pages, since only ever one column shows through the frame at a
   * time, a gap only ever matters as one more term in `columnStepPx`
   * arithmetic, never as visible whitespace. Default 0. */
  columnGapPx?: number;
  /** Every item available to page through, in flow order. A new array
   * *identity* (not just new contents) resets the hook's internal mount
   * window and re-derives the id→index map — pass a stable reference
   * across renders where the underlying list hasn't actually changed. */
  items: PagedColumnsItem[];
  /** Which item's own first fragment to open on. Defaults to `items[0]`. */
  initialAnchorItemId?: string;
  /** Extra whole pages' worth of *estimated* content to keep mounted past
   * the current page on each side — insurance against a page-turn's real
   * measurement coming up short and needing a grow-and-retry round trip.
   * Default 2. */
  mountRadiusPages?: number;
};

type Frag = {
  itemIndex: number;
  fragmentIndex: number;
  columnIndex: number;
  topPx: number;
  bottomPx: number;
};

type Measurement = {
  anchorColumnIndex: number;
  frags: Frag[];
  visibleItems: VisibleItem[];
  hasNextFragment: boolean;
  hasPreviousFragment: boolean;
};

type Result = {
  frameRef: React.RefObject<HTMLDivElement | null>;
  columnsRef: React.RefObject<HTMLDivElement | null>;
  /** Slice `items` with these — same half-open `[start, end)` contract as
   * every other windowing primitive in this family. */
  mountStartIndex: number;
  mountEndIndex: number;
  /** Apply directly as the frame element's `style`. */
  frameStyle: React.CSSProperties;
  /** Apply directly as the columns element's `style` — includes the
   * `translateX` that shows the current page, so the caller never
   * computes that arithmetic itself. */
  columnsStyle: React.CSSProperties;
  /** A ref callback for item `id` — memoized per id, same contract as
   * this package's sibling virtualizers: pass a fresh string each render
   * without forcing React to re-run the ref. */
  registerItemRef: (
    id: string,
  ) => (el: HTMLElement | null) => (() => void) | void;
  /** Real, measured fragments on the current page — see `VisibleItem`'s
   * own doc comment. */
  visibleItems: VisibleItem[];
  /** Changes exactly when `visibleItems` might have, and only then — a
   * cheap `useEffect` dependency for a caller that wants to react to "the
   * displayed page changed" without needing `visibleItems` itself to be
   * referentially stable. */
  pageKey: string;
  /** Turns one page forward. Returns `false` only once the last page is
   * confirmed (the mount window already reaches the end of `items` and no
   * further fragment exists) — otherwise `true`, including the case where
   * this queued a mount-window grow-and-retry that resolves a render or
   * two later. */
  goToNextPage: () => boolean;
  /** Mirror of `goToNextPage`, one page back. */
  goToPreviousPage: () => boolean;
  /** Jumps straight to item `id`'s own first fragment, re-centering the
   * mount window around it — what a section jump or a "load previous"
   * landing calls instead of paging there one step at a time. */
  goToItem: (id: string) => void;
  /** The item id currently anchoring the displayed page — call before
   * changing `items`' identity (e.g. prepending earlier items) so the
   * result can be handed to `goToItem` once the new list has committed,
   * the same "note where the reader is before the list changes shape"
   * role this plays for `useVirtualizedRows`' own `captureAnchor`. */
  captureAnchorItemId: () => string | null;
  /** Best current knowledge — `true` may mean "not confirmed false yet",
   * see `goToNextPage`'s own doc comment. */
  canGoNext: boolean;
  canGoPrevious: boolean;
};

const DEFAULT_MOUNT_RADIUS_PAGES = 2;
// SSR has no real viewport to measure against. A generous guess, corrected
// the instant the client's own ResizeObserver reports the frame's real
// content height.
const DEFAULT_AVAILABLE_HEIGHT_PX = 700;
// Bounds the grow-and-retry loop below — reached only if a single page
// turn's real content genuinely needs this many rounds of "mount another
// guessed page's worth and remeasure" before landing on real content, which
// in practice means either a pathological item-size guess or the true end
// of the list (both of which resolve some other way; see goToNextPage).
const MAX_GROW_ATTEMPTS = 8;

function occupiedFragments(el: HTMLElement): DOMRect[] {
  return Array.from(el.getClientRects()).sort((a, b) => a.left - b.left);
}

/**
 * Mounts a bounded window of `items` into a CSS multi-column flow and
 * hands back everything needed to show one page of it at a time —
 * `frameStyle`/`columnsStyle` for the two nested elements this depends on
 * (see the package README for why fragmentation, not `translateY` over
 * flowing content, is what makes a page boundary always land between two
 * lines rather than through one), and navigation that answers "which page
 * is this on" by reading the browser's own layout rather than trusting a
 * pixel estimate.
 *
 * The frame/columns split is the whole mechanism: the frame is a fixed
 * `columnWidthPx`-wide, `overflow: hidden` window; the columns element
 * inside it declares `column-width: columnWidthPx` and `column-fill:
 * auto` but no `width` of its own, so it inherits the frame's width as
 * its nominal box — exactly one column's worth. Content needing more
 * columns than that box's own width accommodates doesn't wrap to a second
 * row or get refused; CSS multi-column layout renders those columns
 * anyway, extending rightward past the box's nominal edge (a plain
 * consequence of `column-count: auto` sizing columns to `column-width`
 * regardless of how many end up needed, not a hack this package invented
 * — see the README). The frame's own `overflow: hidden` is what turns
 * that overflow into "only one column visible," and `translateX` on the
 * columns element is what picks *which* one.
 *
 * Because every column — including the overflowing ones — is sized from
 * the same single `column-width` value, the pixel distance between
 * adjacent columns is exactly `columnWidthPx + columnGapPx`, uniformly,
 * for the entire flow. That's what makes `columnIndexForOffset` exact
 * rather than approximate, and it's the load-bearing fact this hook's
 * measurement leans on throughout.
 *
 * "Which page is this row on" is answered by comparing an item's own
 * fragment `getClientRects()` position against the *columns element's
 * own* `getBoundingClientRect()`, not against the frame's or the
 * viewport's — both numbers are read after the same `translateX` has
 * been applied to the same element, so the transform cancels out of the
 * subtraction identically no matter its current value. That's what lets
 * this hook skip ever resetting the transform to measure "the real
 * position" the way a naive implementation would need to; a fragment's
 * offset relative to its own (possibly translated) container is already
 * the transform-independent answer.
 */
export function usePagedColumns({
  containerRef,
  columnWidthPx,
  columnGapPx = 0,
  items,
  initialAnchorItemId,
  mountRadiusPages = DEFAULT_MOUNT_RADIUS_PAGES,
}: Params): Result {
  const frameRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);

  const itemsRef = useRef<PagedColumnsItem[] | null>(null);
  const indexByIdRef = useRef<Map<string, number>>(new Map());
  const elementByIdRef = useRef<Map<string, HTMLElement>>(new Map());

  const [availableHeightPx, setAvailableHeightPx] = useState(
    DEFAULT_AVAILABLE_HEIGHT_PX,
  );

  if (itemsRef.current !== items) {
    itemsRef.current = items;
    indexByIdRef.current = new Map(items.map((item, i) => [item.id, i]));
  }

  const [anchorItemId, setAnchorItemIdState] = useState<string | null>(
    () => initialAnchorItemId ?? items[0]?.id ?? null,
  );
  const [anchorFragmentIndex, setAnchorFragmentIndex] = useState(0);

  const sizesOf = useCallback(
    (list: PagedColumnsItem[]) => list.map((item) => item.estimatedSizePx),
    [],
  );

  const [mountWindow, setMountWindow] = useState<MountWindow>(() =>
    estimateMountWindow(
      sizesOf(items),
      anchorItemId ? (indexByIdRef.current.get(anchorItemId) ?? 0) : 0,
      DEFAULT_AVAILABLE_HEIGHT_PX,
      mountRadiusPages,
    ),
  );

  // A pending page turn that couldn't resolve against what's currently
  // mounted — set by goToNextPage/goToPreviousPage, consumed by the
  // measurement effect below once the grown window it triggered has
  // committed and rendered real fragments to search again.
  const pendingNavRef = useRef<"forward" | "backward" | null>(null);
  const growAttemptsRef = useRef(0);

  const [measurement, setMeasurement] = useState<Measurement>({
    anchorColumnIndex: 0,
    frags: [],
    visibleItems: [],
    hasNextFragment: false,
    hasPreviousFragment: false,
  });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const height = el.clientHeight;
      if (height > 0) setAvailableHeightPx(height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef]);

  // A width/height change invalidates every previous fragment count — a
  // paragraph that split into 3 columns at the old width might be 2 or 5
  // at the new one. Landing back on the same anchor *item*'s own first
  // fragment is the paged-mode equivalent of useVirtualizedRows' own
  // reanchor-by-row: "which page contains this locator", not "the same
  // numeric page index", survives the reflow; a fragment index from
  // before it might not even exist any more.
  const layoutKeyRef = useRef(`${columnWidthPx}:${availableHeightPx}`);
  const layoutKey = `${columnWidthPx}:${availableHeightPx}`;
  if (layoutKeyRef.current !== layoutKey) {
    layoutKeyRef.current = layoutKey;
    if (anchorFragmentIndex !== 0) setAnchorFragmentIndex(0);
  }

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const columns = columnsRef.current;
    const list = itemsRef.current;
    if (!frame || !columns || !list || columnWidthPx <= 0) return;

    const frameRect = frame.getBoundingClientRect();
    const columnsRect = columns.getBoundingClientRect();
    const columnStepPx = columnWidthPx + columnGapPx;

    const frags: Frag[] = [];
    for (
      let itemIndex = mountWindow.startIndex;
      itemIndex < mountWindow.endIndex;
      itemIndex++
    ) {
      const item = list[itemIndex];
      const el = elementByIdRef.current.get(item.id);
      if (!el) continue;
      const rects = occupiedFragments(el);
      rects.forEach((rect, fragmentIndex) => {
        frags.push({
          itemIndex,
          fragmentIndex,
          columnIndex: columnIndexForOffset(
            rect.left - columnsRect.left,
            columnStepPx,
          ),
          topPx: rect.top - frameRect.top,
          bottomPx: rect.bottom - frameRect.top,
        });
      });
    }

    const anchorIndex = anchorItemId
      ? (indexByIdRef.current.get(anchorItemId) ?? null)
      : null;
    const anchorFrag =
      anchorIndex === null
        ? undefined
        : (frags.find(
            (f) =>
              f.itemIndex === anchorIndex &&
              f.fragmentIndex === anchorFragmentIndex,
          ) ?? frags.find((f) => f.itemIndex === anchorIndex));
    const anchorColumnIndex = anchorFrag?.columnIndex ?? 0;

    const visibleItems: VisibleItem[] = frags
      .filter((f) => f.columnIndex === anchorColumnIndex)
      .map((f) => ({
        id: list[f.itemIndex].id,
        topPx: f.topPx,
        bottomPx: f.bottomPx,
      }));

    const hasNextFragment = frags.some(
      (f) => f.columnIndex === anchorColumnIndex + 1,
    );
    const hasPreviousFragment = frags.some(
      (f) => f.columnIndex === anchorColumnIndex - 1,
    );

    setMeasurement({
      anchorColumnIndex,
      frags,
      visibleItems,
      hasNextFragment,
      hasPreviousFragment,
    });

    // Resolve a pending page turn once real fragments exist to search —
    // see goToNextPage's own doc comment for why this loop, rather than a
    // synchronous answer, is what a grow-and-retry has to look like: the
    // browser hasn't laid out the newly mounted items until this same
    // effect's next run.
    const pending = pendingNavRef.current;
    if (pending) {
      const target = anchorColumnIndex + (pending === "forward" ? 1 : -1);
      const candidates = frags.filter((f) => f.columnIndex === target);
      if (candidates.length > 0) {
        const chosen =
          pending === "forward"
            ? candidates[0]
            : candidates[candidates.length - 1];
        pendingNavRef.current = null;
        growAttemptsRef.current = 0;
        setAnchorItemIdState(list[chosen.itemIndex].id);
        setAnchorFragmentIndex(chosen.fragmentIndex);
      } else {
        const canGrow =
          pending === "forward"
            ? mountWindow.endIndex < list.length
            : mountWindow.startIndex > 0;
        if (canGrow && growAttemptsRef.current < MAX_GROW_ATTEMPTS) {
          growAttemptsRef.current += 1;
          setMountWindow((prev) =>
            growMountWindow(
              sizesOf(list),
              prev,
              pending === "forward" ? "forward" : "backward",
              availableHeightPx,
            ),
          );
        } else {
          // Confirmed: nothing more in that direction — give up rather
          // than spin forever on a guess that will never pan out.
          pendingNavRef.current = null;
          growAttemptsRef.current = 0;
        }
      }
    } else if (anchorIndex !== null) {
      // Grow-on-demand (above) only ever extends the window — nothing
      // shrinks it back down as the reader pages on, so a long session
      // within one section would otherwise accumulate every page it ever
      // passed through as still-mounted DOM. Swapping in a fresh
      // estimate recentred on the current anchor is safe any time no
      // page turn is in flight (the fresh window always covers the
      // anchor plus a full radius, so the anchor's own fragments are
      // never at risk of unmounting out from under it) — gated behind a
      // 3x-oversized check so this only fires once real slack has
      // accumulated, not after every single page turn.
      const fresh = estimateMountWindow(
        sizesOf(list),
        anchorIndex,
        availableHeightPx,
        mountRadiusPages,
      );
      const freshSpan = fresh.endIndex - fresh.startIndex;
      const currentSpan = mountWindow.endIndex - mountWindow.startIndex;
      if (
        currentSpan > freshSpan * 3 &&
        (fresh.startIndex > mountWindow.startIndex ||
          fresh.endIndex < mountWindow.endIndex)
      ) {
        setMountWindow(fresh);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mountWindow.startIndex,
    mountWindow.endIndex,
    anchorItemId,
    anchorFragmentIndex,
    columnWidthPx,
    columnGapPx,
    availableHeightPx,
    items,
  ]);

  function registerItemRef(id: string) {
    return (el: HTMLElement | null) => {
      if (!el) return;
      elementByIdRef.current.set(id, el);
      return () => {
        if (elementByIdRef.current.get(id) === el) {
          elementByIdRef.current.delete(id);
        }
      };
    };
  }

  function goToNextPage(): boolean {
    if (measurement.hasNextFragment) {
      const target = measurement.anchorColumnIndex + 1;
      const candidate = measurement.frags.find((f) => f.columnIndex === target);
      if (candidate && itemsRef.current) {
        setAnchorItemIdState(itemsRef.current[candidate.itemIndex].id);
        setAnchorFragmentIndex(candidate.fragmentIndex);
        return true;
      }
    }
    const list = itemsRef.current ?? [];
    if (mountWindow.endIndex >= list.length) return false;
    pendingNavRef.current = "forward";
    growAttemptsRef.current = 0;
    setMountWindow((prev) =>
      growMountWindow(sizesOf(list), prev, "forward", availableHeightPx),
    );
    return true;
  }

  function goToPreviousPage(): boolean {
    if (measurement.hasPreviousFragment) {
      const target = measurement.anchorColumnIndex - 1;
      const candidates = measurement.frags.filter(
        (f) => f.columnIndex === target,
      );
      const candidate = candidates[candidates.length - 1];
      if (candidate && itemsRef.current) {
        setAnchorItemIdState(itemsRef.current[candidate.itemIndex].id);
        setAnchorFragmentIndex(candidate.fragmentIndex);
        return true;
      }
    }
    if (mountWindow.startIndex <= 0) return false;
    pendingNavRef.current = "backward";
    growAttemptsRef.current = 0;
    setMountWindow((prev) =>
      growMountWindow(
        sizesOf(itemsRef.current ?? []),
        prev,
        "backward",
        availableHeightPx,
      ),
    );
    return true;
  }

  function goToItem(id: string) {
    const list = itemsRef.current ?? [];
    const index = indexByIdRef.current.get(id);
    if (index === undefined) return;
    pendingNavRef.current = null;
    growAttemptsRef.current = 0;
    setAnchorItemIdState(id);
    setAnchorFragmentIndex(0);
    setMountWindow(
      estimateMountWindow(
        sizesOf(list),
        index,
        availableHeightPx,
        mountRadiusPages,
      ),
    );
  }

  function captureAnchorItemId(): string | null {
    return anchorItemId;
  }

  const frameStyle = useMemo<React.CSSProperties>(
    () => ({
      width: columnWidthPx,
      height: availableHeightPx,
      overflow: "hidden",
    }),
    [columnWidthPx, availableHeightPx],
  );

  const columnsStyle = useMemo<React.CSSProperties>(
    () => ({
      columnWidth: columnWidthPx,
      columnGap: columnGapPx,
      columnFill: "auto",
      height: availableHeightPx,
      transform: `translateX(${-(measurement.anchorColumnIndex * (columnWidthPx + columnGapPx))}px)`,
    }),
    [
      columnWidthPx,
      columnGapPx,
      availableHeightPx,
      measurement.anchorColumnIndex,
    ],
  );

  return {
    frameRef,
    columnsRef,
    mountStartIndex: mountWindow.startIndex,
    mountEndIndex: mountWindow.endIndex,
    frameStyle,
    columnsStyle,
    registerItemRef,
    visibleItems: measurement.visibleItems,
    pageKey: `${anchorItemId ?? ""}:${anchorFragmentIndex}`,
    goToNextPage,
    goToPreviousPage,
    goToItem,
    captureAnchorItemId,
    canGoNext:
      measurement.hasNextFragment ||
      mountWindow.endIndex < (itemsRef.current?.length ?? 0),
    canGoPrevious:
      measurement.hasPreviousFragment || mountWindow.startIndex > 0,
  };
}
