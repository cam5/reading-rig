/**
 * Anchors the selection callout (SelectionToolbar) centered above a pending
 * selection's bounding rect, caret-first — unlike floatingPosition (used by
 * NoteComposer, a left-anchored card), an iOS-style callout centers on the
 * selection's horizontal midpoint, not its left edge. `translate(-50%,
 * -100%)` does the centering/lift in CSS from a single left/top point,
 * rather than needing the pill's own rendered width up front.
 */
export function calloutPosition(rect: DOMRect): {
  left: number;
  top: number;
  transform: string;
} {
  return {
    left: rect.left + rect.width / 2,
    top: rect.top - 12,
    transform: "translate(-50%, -100%)",
  };
}
