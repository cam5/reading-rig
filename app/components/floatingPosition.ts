/**
 * Anchors a floating element just above the given rect — the position
 * NoteComposer uses for a pending text selection's bounding rect (see
 * SelectionHighlighter's "known rough edge" doc comment: this is captured
 * once, not re-anchored on scroll).
 *
 * Clamps to the viewport (8px margin) so the card can't land partly or
 * fully off-screen — `rect.left` alone routinely does that on a narrow
 * phone. `width` is the caller's own rendered width, since this runs
 * before the element exists to measure; pass the same value the caller
 * caps its own width at.
 */
export function floatingPosition(
  rect: DOMRect,
  width = 320,
): { left: number; top: number } {
  const margin = 8;
  const maxLeft = Math.max(window.innerWidth - width - margin, margin);
  return {
    left: Math.min(Math.max(rect.left, margin), maxLeft),
    top: Math.max(rect.top - 44, margin),
  };
}
