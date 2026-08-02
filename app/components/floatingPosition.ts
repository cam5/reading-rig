// On a narrow viewport, anchoring straight to the selection's rect puts the
// floating element half off-screen whenever the selection ends near the
// right edge — or above the viewport entirely, for a selection on the first
// line. Clamp both axes with a small margin; `width` is the caller's own
// rendered width, since this can't measure an element that isn't mounted
// yet. On a desktop-width column neither bound ever binds, so the position
// there is exactly the unclamped one.
const VIEWPORT_MARGIN_PX = 8;

/**
 * Anchors a floating element just above the given rect — the position
 * SelectionToolbar and NoteComposer both use for a pending text
 * selection's bounding rect (see SelectionHighlighter's "known rough
 * edge" doc comment: this is captured once, not re-anchored on scroll).
 */
export function floatingPosition(rect: DOMRect, width: number): { left: number; top: number } {
  if (typeof window === "undefined") return { left: rect.left, top: rect.top - 44 };
  return {
    left: Math.max(VIEWPORT_MARGIN_PX, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN_PX)),
    top: Math.max(VIEWPORT_MARGIN_PX, rect.top - 44),
  };
}
