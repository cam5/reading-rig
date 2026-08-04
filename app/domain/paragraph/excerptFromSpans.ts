import type { ElementSpan } from "./resolveSelectionOffset";

/**
 * The text a selection's resolved spans actually cover, stitched back
 * together the same way read.tsx's sidebar reconstructs a Highlight's full
 * string: each span's own textContent slice, joined with " ". Works
 * uniformly for a single-paragraph span (the join is a no-op) and a
 * spanning selection alike, so callers don't need to special-case either.
 */
export function excerptFromSpans(spans: ElementSpan[]): string {
  return spans.map((span) => (span.element.textContent ?? "").slice(span.start, span.end)).join(" ");
}
