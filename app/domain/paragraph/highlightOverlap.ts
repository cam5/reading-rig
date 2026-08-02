import { rangesOverlap } from "./range";

export type SpanRange = { paragraphId: string; start: number; end: number };

/**
 * True if any of `candidates` overlaps any of `existing` on the same
 * paragraph, under the same half-open `[start, end)` convention
 * mergeHighlights.ts uses — including an exact duplicate. Two spans that
 * merely touch (one's `end` equals the other's `start`) don't overlap.
 *
 * mergeHighlightsIntoHtml refuses to render two highlights over the same
 * character rather than silently attributing it to whichever comes first
 * (see its own doc comment) — this is the write-side half of that: reject
 * the overlap before it's ever persisted, instead of only discovering it
 * later, mid-render, for every reader of that paragraph.
 */
export function overlapsExisting(candidates: SpanRange[], existing: SpanRange[]): boolean {
  return candidates.some((c) =>
    existing.some((e) => e.paragraphId === c.paragraphId && rangesOverlap(c, e)),
  );
}
