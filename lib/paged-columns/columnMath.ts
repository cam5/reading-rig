/**
 * Pure math shared by usePagedColumns — no DOM, no React. Two independent
 * jobs live here, and they never trade places:
 *
 *  - `estimateMountWindow` decides *how much* content to hand the browser
 *    before any of it has been laid out, from nothing but a caller-supplied
 *    "about how big is this" guess per item. It is always wrong by some
 *    margin (that's what makes it an estimate) — its only job is to be
 *    generous enough that real column fragmentation has something to work
 *    with, not to predict where a page boundary falls.
 *  - `columnIndexForOffset` turns a real, browser-measured pixel offset
 *    into a column number. It is never wrong, because it never guesses —
 *    every column in a `column-width`-only multicol flow is the same
 *    width (see usePagedColumns' own doc comment for why), so dividing a
 *    real offset by that width is exact, not approximate.
 *
 * Conflating these two — trusting an estimate to answer where a page
 * boundary actually is — is the bug this whole package exists to avoid.
 * See the package README for the concrete failure that motivated the
 * split.
 */

export type MountWindow = { startIndex: number; endIndex: number };

/**
 * Which items (by index into `estimatedSizesPx`) to mount around
 * `anchorIndex` — a half-open `[startIndex, endIndex)` window extended by
 * `radiusPages` worth of `pageSizePx`-tall guessed budget on each side.
 *
 * A plain outward walk, not a binary search: this runs on a page turn or a
 * mount-window regrowth, at most a handful of times a second even under
 * fast paging, not on every scroll frame the way a scroll-mode virtualizer
 * would need to.
 *
 * Never returns an empty window for a non-empty list — `anchorIndex` is
 * clamped into range first, so there's always at least the anchor item
 * itself to mount and measure a real column position from.
 */
export function estimateMountWindow(
  estimatedSizesPx: number[],
  anchorIndex: number,
  pageSizePx: number,
  radiusPages: number,
): MountWindow {
  const n = estimatedSizesPx.length;
  if (n === 0) return { startIndex: 0, endIndex: 0 };

  const anchor = Math.max(0, Math.min(anchorIndex, n - 1));
  const budgetPx = Math.max(0, radiusPages) * Math.max(1, pageSizePx);

  let startIndex = anchor;
  let spentBackward = 0;
  while (startIndex > 0 && spentBackward < budgetPx) {
    startIndex -= 1;
    spentBackward += estimatedSizesPx[startIndex] || pageSizePx;
  }

  let endIndex = anchor + 1;
  let spentForward = 0;
  while (endIndex < n && spentForward < budgetPx) {
    spentForward += estimatedSizesPx[endIndex] || pageSizePx;
    endIndex += 1;
  }

  return { startIndex, endIndex };
}

/**
 * Grows an existing window outward by one more `pageSizePx`-tall guessed
 * budget, in `direction` only — what usePagedColumns' retry loop calls
 * when a page turn's real measurement comes up short (the target column
 * isn't mounted yet) rather than recomputing a fresh window from scratch,
 * so a repeated retry keeps whatever's already mounted on the other side
 * instead of discarding and re-mounting it.
 */
export function growMountWindow(
  estimatedSizesPx: number[],
  window: MountWindow,
  direction: "forward" | "backward",
  pageSizePx: number,
): MountWindow {
  const n = estimatedSizesPx.length;
  const budgetPx = Math.max(1, pageSizePx);

  if (direction === "forward") {
    let endIndex = window.endIndex;
    let spent = 0;
    while (endIndex < n && spent < budgetPx) {
      spent += estimatedSizesPx[endIndex] || pageSizePx;
      endIndex += 1;
    }
    return { startIndex: window.startIndex, endIndex };
  }

  let startIndex = window.startIndex;
  let spent = 0;
  while (startIndex > 0 && spent < budgetPx) {
    startIndex -= 1;
    spent += estimatedSizesPx[startIndex] || pageSizePx;
  }
  return { startIndex, endIndex: window.endIndex };
}

/**
 * The real answer: which column (0-based, uniform-width) a fragment
 * measured `offsetPx` from the flow's own untransformed start belongs to.
 * `offsetPx` has to already have any CSS transform cancelled out of it —
 * see usePagedColumns' own doc comment on why comparing a fragment's rect
 * against its columns container's own rect (rather than against a fixed
 * viewport origin) does that for free, no matter what `translateX` is
 * currently applied.
 *
 * A plain `round`, not `floor`: sub-pixel layout rounding can land a
 * fragment's measured offset a fraction either side of its column's exact
 * boundary, and `round` is unbiased about which way that falls; `floor`
 * would systematically under-count by one column right at the boundary.
 */
export function columnIndexForOffset(
  offsetPx: number,
  columnStepPx: number,
): number {
  if (columnStepPx <= 0) return 0;
  return Math.round(offsetPx / columnStepPx);
}
