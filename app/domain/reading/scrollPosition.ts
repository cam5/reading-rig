/**
 * A paragraph the scroll listener found in the DOM, reduced to just what
 * picking the reader's "current" one needs: its place in the whole work's
 * reading order, and how far its top sits from the reading column's own
 * top edge, in px. Positive means still below the column's top; negative
 * means it has already scrolled above it.
 */
export type ScrollCandidate = { id: string; globalOrdinal: number; topOffsetPx: number };

/**
 * Which paragraph the reader is "at": among every paragraph whose top has
 * crossed above the reading column's own top edge by less than
 * `thresholdPx` (a small allowance, not the exact pixel — a paragraph just
 * barely crossing the line still counts), the one furthest into the work.
 * `null` when nothing has crossed yet (e.g. still at the very top of the
 * work, before its first paragraph's threshold).
 *
 * One rule, two different consumers: the bookmark (clamped monotonic by
 * the caller, so scrolling back up to re-read something never rewinds it)
 * and the scroll-driven "current section" for the URL (#54 — not clamped,
 * since scrolling back up should move the URL, and SectionNav's prev/next
 * targets, back with it).
 */
export function pickCurrentParagraph(candidates: ScrollCandidate[], thresholdPx: number): ScrollCandidate | null {
  let best: ScrollCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.topOffsetPx < thresholdPx && (best === null || candidate.globalOrdinal > best.globalOrdinal)) {
      best = candidate;
    }
  }
  return best;
}
