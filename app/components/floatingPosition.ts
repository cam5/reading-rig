/**
 * Anchors a floating element just above the given rect — the position
 * SelectionToolbar and NoteComposer both use for a pending text
 * selection's bounding rect (see SelectionHighlighter's "known rough
 * edge" doc comment: this is captured once, not re-anchored on scroll).
 */
export function floatingPosition(rect: DOMRect): { left: number; top: number } {
  return { left: rect.left, top: rect.top - 44 };
}
