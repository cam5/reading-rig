export type VirtualWindow = {
  /** First mounted paragraph index. */
  startIndex: number;
  /** One past the last mounted paragraph index — `[startIndex, endIndex)`. */
  endIndex: number;
  /** Height (px) of the spacer standing in for every unmounted paragraph above `startIndex`. */
  topSpacerHeight: number;
  /** Height (px) of the spacer standing in for every unmounted paragraph at or after `endIndex`. */
  bottomSpacerHeight: number;
};

/**
 * Which paragraphs to actually mount, given each paragraph's height (its
 * real height once a `ResizeObserver` has reported it, or an estimate until
 * then) and the current scroll position. Spacers carry the unmounted
 * paragraphs' combined height so total scroll height — and scrollbar
 * proportions — stay correct without every paragraph existing as a DOM
 * node. A binary search over cumulative offsets, not a linear scan, since a
 * full novel is ~2000 paragraphs and this runs on every scroll tick.
 *
 * `overscanPx` extends the mount range this many px beyond the viewport on
 * each side — cheap insurance against a pop-in flash on a fast scroll, and
 * (deliberately) the only thing standing between a live text selection and
 * its target paragraph disappearing mid-drag. That's an acceptable trade,
 * not an oversight: a *completed* highlight is a `HighlightSpan` row, not
 * DOM state, so it re-renders correctly whenever its paragraph remounts —
 * only a selection still being dragged when a paragraph unmounts is at
 * risk, and dragging one further than `overscanPx` off-screen without
 * releasing the mouse isn't a gesture worth designing around.
 */
export function computeVirtualWindow(
  heights: number[],
  scrollTop: number,
  viewportHeight: number,
  overscanPx: number,
): VirtualWindow {
  const n = heights.length;
  if (n === 0)
    return {
      startIndex: 0,
      endIndex: 0,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    };

  const offsets = new Array<number>(n + 1);
  offsets[0] = 0;
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i] + heights[i];
  const totalHeight = offsets[n];

  // A degenerate all-zero-height list (nothing measured yet, no estimate
  // supplied) has no meaningful window to compute — mount everything rather
  // than divide the range into paragraphs with no actual extent.
  if (totalHeight <= 0)
    return {
      startIndex: 0,
      endIndex: n,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    };

  const viewTop = Math.max(0, scrollTop - overscanPx);
  const viewBottom = Math.min(
    totalHeight,
    scrollTop + viewportHeight + overscanPx,
  );

  // startIndex: the paragraph containing viewTop (start-offset inclusive —
  // a paragraph whose top offset lands exactly on viewTop still belongs to
  // the mounted range). endIndex: exclusive, so it's the *first* paragraph
  // starting at or after viewBottom, not the paragraph containing
  // viewBottom — a paragraph beginning exactly where the viewport ends
  // doesn't overlap it at all, under the same half-open convention
  // HighlightSpan ranges use elsewhere in this codebase.
  const startIndex = lastOffsetAtMost(offsets, viewTop);
  const endIndex = firstOffsetAtLeast(offsets, viewBottom);

  return {
    startIndex,
    endIndex,
    topSpacerHeight: offsets[startIndex],
    bottomSpacerHeight: totalHeight - offsets[endIndex],
  };
}

/**
 * Which row occupies scroll offset `position` — the row the reader is
 * looking at when `position` is the container's own `scrollTop`.
 *
 * Distinct from `computeVirtualWindow`'s `startIndex`, which sits a whole
 * `overscanPx` earlier: the rows in between are mounted but above the
 * fold, and a height correction landing on one of them displaces the
 * reader exactly as much as one further up does. Anything trying to hold
 * the reader's position steady has to measure against this row, not the
 * window's first one.
 *
 * A linear walk rather than the binary search below, because it runs off
 * measurement batches (a handful per second at most) rather than per
 * scroll frame, and it needs no `offsets` array built first.
 */
export function rowIndexAtOffset(heights: number[], position: number): number {
  let offset = 0;
  for (let i = 0; i < heights.length; i++) {
    offset += heights[i] ?? 0;
    if (offset > position) return i;
  }
  return Math.max(0, heights.length - 1);
}

/** Largest `i` (out of the paragraph-start offsets `offsets[0..offsets.length - 2]`) with `offsets[i] <= position`. */
function lastOffsetAtMost(offsets: number[], position: number): number {
  const n = offsets.length - 1;
  const clamped = Math.min(Math.max(position, 0), offsets[n] - Number.EPSILON);
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= clamped) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Smallest `i` with `offsets[i] >= position` — `offsets[offsets.length - 1]` (the work's total height) is always a valid answer, so this never falls off the end. */
function firstOffsetAtLeast(offsets: number[], position: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] >= position) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
