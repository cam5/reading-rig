import {
  resolveSelectionSpans,
  type ElementSpan,
  type RangeLike,
} from "./resolveSelectionOffset";

// nodeType checked as a raw number (3), not via the `Node` global — this
// module runs in tests under plain Node.js (see resolveSelectionOffset.ts),
// where `Node` isn't defined.
function closestParagraph(node: Node): HTMLElement | null {
  const anchor =
    node.nodeType === 3
      ? (node as unknown as { parentElement: Element | null }).parentElement
      : (node as unknown as Element);
  return (
    (anchor as HTMLElement | null)?.closest<HTMLElement>(
      "[data-paragraph-id]",
    ) ?? null
  );
}

/**
 * Given a reading column (`container`, holding one or more elements marked
 * `[data-paragraph-id]`) and a selection's boundary points, resolves which
 * paragraphs it touches and the per-paragraph spans within them — or `null`
 * if there's nothing to resolve. This is the layer above
 * resolveSelectionSpans that turns "a Range somewhere in the document" into
 * "the ordered list of paragraph elements it actually reaches", which that
 * function assumes has already been done.
 *
 * A selection can start or end outside `container` entirely — a triple
 * click on the *last* paragraph in the column can carry its selection past
 * the column's own end, since the browser extends the boundary to the
 * start of whatever comes next in the document (unrelated sidebar content,
 * not another paragraph). Range guarantees startContainer precedes
 * endContainer in document order, so when only one side is actually inside
 * `container`, the other clamps to that side's own edge — first paragraph
 * for a start outside, last paragraph for an end outside — rather than the
 * whole selection being dropped. A clamped boundary becomes a synthetic
 * "whole paragraph" edge (element container, offset 0 or
 * `childNodes.length`), which resolveSelectionSpans already knows how to
 * resolve.
 */
export function resolveContainerSelectionSpans(
  container: Element,
  range: RangeLike,
): ElementSpan[] | null {
  const startInside = container.contains(range.startContainer);
  const endInside = container.contains(range.endContainer);
  if (!startInside && !endInside) return null;

  const allParagraphs = Array.from(
    container.querySelectorAll<HTMLElement>("[data-paragraph-id]"),
  );
  if (allParagraphs.length === 0) return null;

  const startParagraph = startInside
    ? closestParagraph(range.startContainer)
    : allParagraphs[0];
  const endParagraph = endInside
    ? closestParagraph(range.endContainer)
    : allParagraphs[allParagraphs.length - 1];
  if (!startParagraph || !endParagraph) return null;

  const startIndex = allParagraphs.indexOf(startParagraph);
  const endIndex = allParagraphs.indexOf(endParagraph);
  if (startIndex === -1 || endIndex === -1) return null;

  const [lo, hi] =
    startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  const candidates = allParagraphs.slice(lo, hi + 1);

  const effectiveRange: RangeLike = {
    startContainer: startInside ? range.startContainer : startParagraph,
    startOffset: startInside ? range.startOffset : 0,
    endContainer: endInside ? range.endContainer : endParagraph,
    endOffset: endInside ? range.endOffset : endParagraph.childNodes.length,
  };

  // Resolved here, once, rather than re-derived later from raw paragraph
  // elements + range: a triple click can also leave range.endContainer
  // sitting at offset 0 of the *next* paragraph (a narrower version of the
  // same quirk — functionally the same as selecting the whole clicked
  // paragraph), and resolveSelectionSpans already trims that phantom
  // reach. Re-resolving from a post-trim element list later would fail,
  // since the boundary container wouldn't live inside it.
  return resolveSelectionSpans(candidates, effectiveRange);
}
