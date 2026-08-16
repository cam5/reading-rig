import { createPillElement, type PillCandidate } from "./tokenPill";
import { collapseInto, hasContentAfter } from "./tokenComposerCaret";
import type { MentionAnchor } from "./tokenComposerMention";

/**
 * DOM surgery for TokenComposer's pills, plus its manual Enter handling —
 * the highest-trivia part of the composer, isolated so the component itself
 * can read as ordinary React. Every export here mutates the contentEditable
 * directly and leaves the caret somewhere sane; none of it touches React
 * state or refs, which stay the caller's job (pillDataRef bookkeeping and
 * the `hasOnScreenPill` flag in particular).
 */

/** The pill the caret is sitting immediately after, if any. */
export function pillBeforeCaret(
  range: Range,
  root: HTMLElement,
): HTMLElement | null {
  const { startContainer, startOffset } = range;
  let previous: Node | null;
  if (startContainer.nodeType === Node.TEXT_NODE) {
    // Anywhere but the very start of the node and there's an ordinary
    // character to the caret's left for the browser to delete.
    if (startOffset > 0) return null;
    previous = startContainer.previousSibling;
  } else {
    previous = startContainer.childNodes[startOffset - 1] ?? null;
  }
  // Step over the empty text nodes insertPillAtMention parks after each pill.
  while (previous?.nodeType === Node.TEXT_NODE && !previous.textContent) {
    previous = previous.previousSibling;
  }
  if (
    previous instanceof HTMLElement &&
    previous.dataset.pillId &&
    root.contains(previous)
  ) {
    return previous;
  }
  return null;
}

/**
 * Splices `candidate` in as a pill at `anchor` (an open "@query"),
 * replacing the "@" and its query text with the pill, and leaves the caret
 * in a fresh text node right after it. `fallbackQueryLength` covers the
 * case where the live caret has moved off the mention's text node by the
 * time this runs. `instanceId` is this particular insertion's own key —
 * see pillId's comment on why it isn't just `pillId(candidate)` — and is
 * what ends up in the pill's `data-pill-id`, not whatever createPillElement
 * would default to.
 */
export function insertPillAtMention(
  root: HTMLElement,
  anchor: MentionAnchor,
  fallbackQueryLength: number,
  candidate: PillCandidate,
  instanceId: string,
): void {
  const { textNode, atOffset } = anchor;
  const selection = window.getSelection();
  // The live caret is authoritative — the suggestion rows' onMouseDown
  // preventDefault keeps the selection on this very node — with the typed
  // query's length as the fallback for anything that moved it anyway.
  const caretOffset =
    selection?.isCollapsed && selection.anchorNode === textNode
      ? selection.anchorOffset
      : Math.min(atOffset + 1 + fallbackQueryLength, textNode.length);

  const mentionText = textNode.splitText(atOffset);
  const afterCaret = mentionText.splitText(Math.max(caretOffset - atOffset, 0));
  const parent = mentionText.parentNode;
  if (!parent) return;

  const pill = createPillElement(candidate);
  pill.dataset.pillId = instanceId;
  parent.replaceChild(pill, mentionText);

  // Where the caret goes against an atomic contenteditable=false node is
  // inconsistent across browsers; an empty text node of our own gives it
  // somewhere unambiguous to sit.
  const caretHome = document.createTextNode("");
  parent.insertBefore(caretHome, pill.nextSibling);
  // The common case (caret was at the end of "@query", nothing typed
  // after it) leaves `afterCaret` empty — a second, redundant empty text
  // node sitting right next to caretHome. Two adjacent empty text nodes
  // is exactly the shape that made a later same-node "@" retype vanish
  // (a real, reproduced bug): Chromium's insertText handling merges them
  // unpredictably, and the preceding space came out consumed with it,
  // which then made a legitimate new mention read as "mid-word" and fail
  // to open. Dropping the empty duplicate rather than keeping both nodes
  // sidesteps that merge path entirely; a non-empty `afterCaret` (real
  // trailing text) is left in place; it's real content, not the ambiguity.
  if (!afterCaret.textContent) afterCaret.remove();
  root.focus();
  collapseInto(caretHome, 0);
}

/**
 * Prepends `candidate` as a pill before whatever's already in `root` and
 * leaves the caret in a fresh text node right after it — the composer's
 * other entry point for a pill, for when there's no "@query" to splice it
 * into (TokenComposer's `seedPill`: the reader already had something
 * selected before the composer was ever focused, so there's nothing to
 * replace, only somewhere to insert).
 */
export function insertPillAtStart(
  root: HTMLElement,
  candidate: PillCandidate,
  instanceId: string,
): void {
  const pill = createPillElement(candidate);
  pill.dataset.pillId = instanceId;
  const caretHome = document.createTextNode("");
  root.insertBefore(caretHome, root.firstChild);
  root.insertBefore(pill, caretHome);
  root.focus();
  collapseInto(caretHome, 0);
}

/**
 * Removes `pill` and returns the caret to the end of whatever real text
 * preceded it.
 */
export function removePillBeforeCaret(pill: HTMLElement): void {
  // The caret's current node — the empty text node insertPillAtMention
  // parks after every pill (see its own comment) — stays put once the
  // pill is gone, since removing a sibling doesn't move an existing
  // Range. Collapsing onto the end of whatever real text preceded the
  // pill instead, rather than leaving the caret in that now-pointless
  // empty node, is what the rest of this function depends on.
  const before = pill.previousSibling;
  pill.remove();
  if (before?.nodeType === Node.TEXT_NODE) {
    const text = before.textContent ?? "";
    // Reproduced bug: type "about ", insert a pill, backspace it, type
    // "@" — the space vanishes and a legitimate mention silently fails
    // to open. A plain U+0020 (not the U+00A0 a real keystroke leaves
    // when it lands at the very end of the field) is CSS-collapsible
    // per white-space:normal; once removing the pill makes `before`
    // the last real content in the composer, that plain space becomes
    // exactly that "collapsible trailing space" case, and Chromium's
    // insertText drops it on the next keystroke rather than typing
    // after it. Swapping it for U+00A0 matches what native typing
    // would have produced in that position and sidesteps the collapse.
    if (text.endsWith(" ") && !hasContentAfter(before)) {
      before.textContent = `${text.slice(0, -1)} `;
    }
    collapseInto(before, before.textContent?.length ?? 0);
  }
}

/**
 * Inserts a manual line break at the caret — contentEditable's own Enter
 * handling is cross-browser inconsistent, so the composer does this by hand.
 */
export function insertLineBreakAtCaret(): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const br = document.createElement("br");
  range.insertNode(br);

  const caretHome = document.createTextNode("");
  br.parentNode?.insertBefore(caretHome, br.nextSibling);
  // A <br> that ends a block opens no line of its own — browsers park a
  // second one there for this reason, and so do we, since we're doing the
  // insertion by hand rather than letting contentEditable's own
  // (cross-browser inconsistent) Enter handling run.
  if (!hasContentAfter(caretHome)) {
    caretHome.parentNode?.insertBefore(
      document.createElement("br"),
      caretHome.nextSibling,
    );
  }
  collapseInto(caretHome, 0);
}
