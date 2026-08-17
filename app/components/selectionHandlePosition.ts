// A line-fragment rect hugs the text's own glyph metrics tightly — a
// couple px shorter, top and bottom, than the highlight band a saved
// Highlight's <mark> will actually paint (which extends with its
// line-height). Overhanging the stem past the rect by this much reads as
// bracketing that fuller band with room to spare, iOS-style, rather than
// looking clipped to the selection's tightest possible box.
const OVERHANG = 3;

/**
 * Positions the two iOS-style selection handles (SelectionHandles) at the
 * edges of a pending text selection — one per line-fragment rect
 * (Range.getClientRects()' first and last entries, captured alongside the
 * bounding rect in SelectionHighlighter), not the selection's overall
 * bounding box. That's what puts each handle on the actual line it marks
 * rather than floating above/below a multi-line selection's outer rect.
 */
export function selectionHandlePositions(
  startRect: DOMRect,
  endRect: DOMRect,
): {
  start: { left: number; top: number; height: number };
  end: { left: number; top: number; height: number };
} {
  return {
    start: {
      left: startRect.left,
      top: startRect.top - OVERHANG,
      height: startRect.height + OVERHANG * 2,
    },
    end: {
      left: endRect.right,
      top: endRect.top - OVERHANG,
      height: endRect.height + OVERHANG * 2,
    },
  };
}
