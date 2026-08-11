/**
 * Selection/Range primitives for TokenComposer's uncontrolled
 * contentEditable — where the caret is, how to move it, and whether the
 * field has anything in it. Nothing here knows about pills or mentions;
 * that domain knowledge lives in tokenComposerEditing.ts and
 * tokenComposerMention.ts respectively.
 */

export function collapseInto(node: Node, offset: number) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function caretRect(): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rect = range.getBoundingClientRect();
  // A collapsed range against an empty text node can measure as all zeroes;
  // the caller falls back to its own box.
  return rect.top === 0 && rect.left === 0 ? null : rect;
}

/** Pills count: their label is part of textContent, so a message that's only
 * a quoted passage is still sendable. */
export function hasContent(root: HTMLElement): boolean {
  return (root.textContent ?? "").trim().length > 0;
}

export function hasContentAfter(node: Node): boolean {
  for (let next = node.nextSibling; next; next = next.nextSibling) {
    if (next.nodeType !== Node.TEXT_NODE || next.textContent) return true;
  }
  return false;
}
