import { estimateMinutesRemaining, formatTimeRemaining } from "./readingTime";

/** A paragraph's contribution to the remaining-words count: its place in
 * the whole work's reading order, and how many words it has. */
export type ProgressParagraph = { globalOrdinal: number; wordCount: number };

/**
 * `progressPercent`'s one definition — `bookmarkGlobalOrdinal / totalParagraphs`,
 * rounded to a whole percent. Used identically whether it's computed on the
 * loader's full page load or recomputed client-side after a scroll-settle
 * debounce (#54, phase 3 of #51): only when/where this runs changed
 * between the two, never what it means.
 */
export function computeProgressPercent(totalParagraphs: number, bookmarkGlobalOrdinal: number): number {
  return totalParagraphs > 0 ? Math.round((bookmarkGlobalOrdinal / totalParagraphs) * 100) : 0;
}

/** Word count of everything still ahead of the bookmark — the numerator
 * `timeLeft` is estimated from. */
export function computeRemainingWords(paragraphs: ProgressParagraph[], bookmarkGlobalOrdinal: number): number {
  return paragraphs
    .filter((p) => p.globalOrdinal > bookmarkGlobalOrdinal)
    .reduce((sum, p) => sum + p.wordCount, 0);
}

/**
 * Both readout values together, from the same two inputs the loader
 * already loads once — the whole work's paragraph count and per-paragraph
 * word counts — so a client-side recompute after each scroll-settle
 * debounce (#54) needs no data beyond what phase 1 (#53) already put in
 * memory; no extra fetch.
 */
export function computeReadingProgress(
  paragraphs: ProgressParagraph[],
  totalParagraphs: number,
  bookmarkGlobalOrdinal: number,
): { progressPercent: number; timeLeft: string } {
  return {
    progressPercent: computeProgressPercent(totalParagraphs, bookmarkGlobalOrdinal),
    timeLeft: formatTimeRemaining(estimateMinutesRemaining(computeRemainingWords(paragraphs, bookmarkGlobalOrdinal))),
  };
}
