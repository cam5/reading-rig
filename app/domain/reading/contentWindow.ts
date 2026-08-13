import type { OrdinalRange } from "./scrollPosition";

/** Everything the windowing math needs about a paragraph without its
 * content — the "structural" tier read.tsx's loader ships for the whole
 * work regardless of length. `wordCount` is precomputed at ingest
 * (parseEpub.ts) precisely so this type never has to touch `text`. */
export type StructuralParagraph = {
  id: string;
  globalOrdinal: number;
  wordCount: number;
};

/** How much of the initial/extended content window to spend, in bytes.
 * A placeholder estimate — tune against the seeded fixtures (Capital,
 * Pride and Prejudice) once real `/read-content` payload sizes are
 * measurable; this is the one constant this whole module is calibrated
 * against, so it's the first thing to revisit if the byte budget in
 * practice comes out far from ~100KB. */
export const DEFAULT_CONTENT_BYTE_BUDGET = 100 * 1024;

/** Rough bytes-per-word standing in for a paragraph's serialized size
 * (html + text + JSON overhead) until real numbers exist — see
 * DEFAULT_CONTENT_BYTE_BUDGET's own caveat. */
const BYTES_PER_WORD_ESTIMATE = 8;

/** How many mounted-but-unfetched paragraphs of runway to keep past
 * either edge of what's actually loaded before triggering the next
 * fetch — paragraph-count, not px, so it stays meaningful regardless of
 * how tall any given paragraph measures out to be. */
export const DEFAULT_CONTENT_FETCH_LEAD_PARAGRAPHS = 40;

/** For every paragraph added behind the anchor, roughly this many are
 * added ahead of it — reading moves forward, and a section-start anchor
 * (the common case: a fresh load or a deep link) has little "before"
 * worth spending budget on anyway. */
const FORWARD_BIAS = 2;

function estimateBytes(wordCount: number): number {
  return wordCount * BYTES_PER_WORD_ESTIMATE;
}

/** Largest index whose globalOrdinal is <= `target`, clamped to 0 for a
 * target before the first paragraph. `paragraphs` must be
 * globalOrdinal-ascending (the loader's own orderBy) — same binary-search
 * shape as virtualWindow.ts's lastOffsetAtMost, over ordinals instead of
 * cumulative offsets. Every real caller here passes a globalOrdinal that
 * exactly matches some paragraph (an anchor resolved from a real section,
 * or a window edge that was itself read off a real paragraph) — the
 * clamp/rounding-down behavior only matters for out-of-range or
 * hypothetical inputs, e.g. in tests. */
function indexAtOrBefore(
  paragraphs: StructuralParagraph[],
  target: number,
): number {
  if (paragraphs[0].globalOrdinal >= target) return 0;
  let lo = 0;
  let hi = paragraphs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (paragraphs[mid].globalOrdinal <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The shared walk both selectInitialContentWindow and extendContentWindow
 * reduce to: starting from an inclusive `[lo, hi]` index range already
 * "spent" (its own bytes counted in `spentBytes`), keep growing outward —
 * forward-biased ~FORWARD_BIAS:1 — until `byteBudget` is spent or both
 * edges of `paragraphs` are reached. */
function growRange(
  paragraphs: StructuralParagraph[],
  lo: number,
  hi: number,
  spentBytes: number,
  byteBudget: number,
): { lo: number; hi: number } {
  const n = paragraphs.length;
  let bytes = spentBytes;
  let forwardAdded = 0;
  let backwardAdded = 0;

  while (bytes < byteBudget && (lo > 0 || hi < n - 1)) {
    const canForward = hi < n - 1;
    const canBackward = lo > 0;
    const takeForward =
      canForward &&
      (!canBackward || forwardAdded <= backwardAdded * FORWARD_BIAS);
    if (takeForward) {
      hi += 1;
      bytes += estimateBytes(paragraphs[hi].wordCount);
      forwardAdded += 1;
    } else {
      lo -= 1;
      bytes += estimateBytes(paragraphs[lo].wordCount);
      backwardAdded += 1;
    }
  }

  return { lo, hi };
}

/**
 * The initial content window: expands outward from `anchorGlobalOrdinal`
 * (the requested/landing section's first paragraph, or globalOrdinal 1
 * when no section was requested — read.tsx resolves which) until
 * `byteBudget` is spent or the work's edges are hit. A work that fits
 * entirely under budget returns its full range — windowing becomes a
 * no-op by construction for a short work, not a special case any caller
 * needs to branch on.
 *
 * `null` only when the work has no paragraphs at all (nothing to window).
 */
export function selectInitialContentWindow(
  paragraphs: StructuralParagraph[],
  anchorGlobalOrdinal: number,
  byteBudget: number = DEFAULT_CONTENT_BYTE_BUDGET,
): OrdinalRange | null {
  if (paragraphs.length === 0) return null;
  const anchorIndex = indexAtOrBefore(paragraphs, anchorGlobalOrdinal);
  const { lo, hi } = growRange(
    paragraphs,
    anchorIndex,
    anchorIndex,
    estimateBytes(paragraphs[anchorIndex].wordCount),
    byteBudget,
  );
  return {
    minGlobalOrdinal: paragraphs[lo].globalOrdinal,
    maxGlobalOrdinal: paragraphs[hi].globalOrdinal,
  };
}

/**
 * The next increment to fetch in one direction from `currentRange`'s edge
 * — not the new total window; callers (useContentWindow) merge this into
 * what they already have. `null` when there's nothing left in that
 * direction — `currentRange` already reaches the work's start/end —
 * which callers use to stop retriggering that direction's fetch.
 */
export function extendContentWindow(
  paragraphs: StructuralParagraph[],
  currentRange: OrdinalRange,
  direction: "forward" | "backward",
  byteBudget: number = DEFAULT_CONTENT_BYTE_BUDGET,
): OrdinalRange | null {
  if (paragraphs.length === 0) return null;
  const n = paragraphs.length;

  if (direction === "forward") {
    const currentHi = indexAtOrBefore(
      paragraphs,
      currentRange.maxGlobalOrdinal,
    );
    if (currentHi >= n - 1) return null;
    const { hi } = growRange(paragraphs, currentHi, currentHi, 0, byteBudget);
    return {
      minGlobalOrdinal: paragraphs[currentHi + 1].globalOrdinal,
      maxGlobalOrdinal: paragraphs[hi].globalOrdinal,
    };
  }

  const currentLo = indexAtOrBefore(paragraphs, currentRange.minGlobalOrdinal);
  if (currentLo <= 0) return null;
  const { lo } = growRange(paragraphs, currentLo, currentLo, 0, byteBudget);
  return {
    minGlobalOrdinal: paragraphs[lo].globalOrdinal,
    maxGlobalOrdinal: paragraphs[currentLo - 1].globalOrdinal,
  };
}

/**
 * Pure trigger math: has the mounted DOM window (from useVirtualizedRows,
 * translated to globalOrdinal by the caller) come within `leadParagraphs`
 * of either edge of what's actually content-fetched. `mounted` is `null`
 * before anything has been measured client-side — nothing to react to
 * yet, so neither direction fires. Never fires past the work's own
 * bounds, so a fetched range that already reaches the start/end of the
 * book stays settled regardless of how close the mounted window gets.
 */
export function contentFetchTargets(
  mounted: OrdinalRange | null,
  fetched: OrdinalRange,
  workBounds: OrdinalRange,
  leadParagraphs: number = DEFAULT_CONTENT_FETCH_LEAD_PARAGRAPHS,
): { needForward: boolean; needBackward: boolean } {
  if (mounted === null) return { needForward: false, needBackward: false };
  const needForward =
    fetched.maxGlobalOrdinal < workBounds.maxGlobalOrdinal &&
    mounted.maxGlobalOrdinal + leadParagraphs >= fetched.maxGlobalOrdinal;
  const needBackward =
    fetched.minGlobalOrdinal > workBounds.minGlobalOrdinal &&
    mounted.minGlobalOrdinal - leadParagraphs <= fetched.minGlobalOrdinal;
  return { needForward, needBackward };
}
