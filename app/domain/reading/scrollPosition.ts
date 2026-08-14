/**
 * A paragraph the scroll listener found in the DOM, reduced to just what
 * picking the reader's "current" one needs: its place in the whole work's
 * reading order, and how far its top sits from the reading column's own
 * top edge, in px. Positive means still below the column's top; negative
 * means it has already scrolled above it.
 */
export type ScrollCandidate = {
  id: string;
  globalOrdinal: number;
  topOffsetPx: number;
  /** Where the paragraph *ends*, same origin as `topOffsetPx`. Positive
   * means some of it is still on screen; zero or less means it has
   * scrolled entirely above the column's top edge. */
  bottomOffsetPx: number;
};

/**
 * Which paragraph the reader is "at": among every paragraph whose top has
 * crossed above the reading column's own top edge by less than
 * `thresholdPx` (a small allowance, not the exact pixel — a paragraph just
 * barely crossing the line still counts), the one furthest into the work.
 * `null` when nothing has crossed yet (e.g. still at the very top of the
 * work, before its first paragraph's threshold).
 *
 * This answers "how far have I read", and only the bookmark asks that.
 * "Which section am I looking at" is a genuinely different question with a
 * different answer — see `pickCurrentSectionParagraph` below.
 */
export function pickCurrentParagraph(
  candidates: ScrollCandidate[],
  thresholdPx: number,
): ScrollCandidate | null {
  let best: ScrollCandidate | null = null;
  for (const candidate of candidates) {
    if (
      candidate.topOffsetPx < thresholdPx &&
      (best === null || candidate.globalOrdinal > best.globalOrdinal)
    ) {
      best = candidate;
    }
  }
  return best;
}

/**
 * How little of a paragraph can be left on screen before it stops counting
 * as visible at all. Not a tolerance band like the read threshold — purely
 * a rounding allowance: a section deep link lands its divider on the top
 * edge to within a fraction of a pixel, which leaves the previous
 * section's last paragraph showing something like 0.3px. Sub-pixel layout
 * and fractional scroll offsets are the only things this absorbs; anything
 * a reader could actually see is far larger.
 */
export const VISIBLE_EPSILON_PX = 4;

/**
 * Which section the reader is *looking at*: the topmost paragraph actually
 * intersecting the reading column's viewport.
 *
 * Both bounds matter. Without the lower one a paragraph that has scrolled
 * past still counts; without the upper one so does a paragraph thousands
 * of px below the fold, which is not hypothetical — a section deep link
 * mounts its window around the anchor while `scrollTop` is still 0, so on
 * the very first scroll-settle every mounted row sits far below the
 * viewport. Counting those made a deep link report the section *before*
 * the one it had just mounted, and nothing corrected it afterwards
 * because the landing scroll happens before the scroll listener exists.
 * `null` when nothing is on screen — the caller then leaves the URL alone
 * rather than inventing a section from rows nobody can see.
 *
 * Used for the `?section=` URL and SectionNav's prev/next targets. Not
 * clamped monotonic like the bookmark — scrolling back up should move the
 * URL back with it.
 *
 * This used to share `pickCurrentParagraph`'s rule, and inherited an
 * off-by-one-chapter bug from it that reproduced on every single section
 * deep link tested (ch. 3 resolved to 2, 5 to 4, 9 to 8, 10 to 9). Landing
 * on a section puts its divider at the top edge, which leaves the *new*
 * section's first paragraph a divider's height below it — 42px, just past
 * the 40px read threshold — while the previous section's last paragraph
 * sits just above the edge and so still counts as "crossed". The furthest
 * crossed paragraph was therefore always the previous section's, and the
 * reader was told they were a chapter back from where they were plainly
 * looking. Asking which paragraph occupies the top edge, rather than which
 * one most recently passed it, has no such gap to fall into: a divider
 * between two paragraphs belongs to neither, so whichever paragraph is
 * actually on screen wins.
 */
export function pickCurrentSectionParagraph(
  candidates: ScrollCandidate[],
  viewportHeightPx: number,
  visibleEpsilonPx: number = VISIBLE_EPSILON_PX,
): ScrollCandidate | null {
  let best: ScrollCandidate | null = null;
  for (const candidate of candidates) {
    const onScreen =
      candidate.bottomOffsetPx > visibleEpsilonPx &&
      candidate.topOffsetPx < viewportHeightPx;
    if (
      onScreen &&
      (best === null || candidate.globalOrdinal < best.globalOrdinal)
    ) {
      best = candidate;
    }
  }
  return best;
}

/** The globalOrdinal span marginalia scopes itself to (#55, phase 4 of
 * #51): its lower and upper bound, inclusive. */
export type OrdinalRange = {
  minGlobalOrdinal: number;
  maxGlobalOrdinal: number;
};

/**
 * The lowest and highest globalOrdinal among whatever's currently
 * virtualized into the DOM — the same `candidates` list `pickCurrentParagraph`
 * reads, but every one of them, not just those that have crossed the
 * reading column's top edge (marginalia cares about the whole mounted
 * window, not just what's already been "read"). Marginalia (#55) uses
 * this, on the same scroll-settle debounce as everything else in
 * `useBookmarkTracker`, to decide which entries/highlights are "here":
 * anchored to a paragraph whose globalOrdinal falls inside this span.
 * `useVirtualizedRows`' own overscan already mounts well past the literal
 * visible fold, which doubles as the "or near" the ticket asks for — no
 * separate padding needed on top of it. `null` when nothing is mounted at
 * all (e.g. before the reading column has measured anything).
 */
export function computeVisibleOrdinalRange(
  candidates: ScrollCandidate[],
): OrdinalRange | null {
  if (candidates.length === 0) return null;
  let min = candidates[0].globalOrdinal;
  let max = candidates[0].globalOrdinal;
  for (const candidate of candidates) {
    if (candidate.globalOrdinal < min) min = candidate.globalOrdinal;
    if (candidate.globalOrdinal > max) max = candidate.globalOrdinal;
  }
  return { minGlobalOrdinal: min, maxGlobalOrdinal: max };
}
