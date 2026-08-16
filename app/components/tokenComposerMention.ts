import type { CSSProperties } from "react";

const POPUP_WIDTH = 340;
/** Breathing room between the caret and the popup's bottom edge. */
const POPUP_GAP = 6;
const VIEWPORT_MARGIN = 8;

/** An in-progress "@query" at the caret, anchored to the text node and
 * offset where its "@" lives. */
export type MentionMatch = { textNode: Text; atOffset: number; query: string };

/** Just enough of a MentionMatch to splice a pill back in later — the query
 * text itself isn't needed once the popup's already open against it. */
export type MentionAnchor = Pick<MentionMatch, "textNode" | "atOffset">;

/**
 * The mention being typed at the caret, if there is one. Scans backwards
 * within the caret's own Text node only — a pill is always its own sibling
 * node, so a mention typed straight after one starts in a fresh Text node
 * and there's never a reason to cross a boundary.
 */
export function readMentionAtCaret(root: HTMLElement): MentionMatch | null {
  const selection = window.getSelection();
  if (!selection?.isCollapsed) return null;
  const { anchorNode, anchorOffset } = selection;
  if (
    !anchorNode ||
    anchorNode.nodeType !== Node.TEXT_NODE ||
    !root.contains(anchorNode)
  )
    return null;

  const textNode = anchorNode as Text;
  const before = textNode.data.slice(0, anchorOffset);
  const atOffset = before.lastIndexOf("@");
  if (atOffset === -1) return null;
  // Only an "@" that opens a word counts, so email addresses and the like
  // don't drag the popup open mid-token.
  if (atOffset > 0 && !/\s/.test(before[atOffset - 1])) return null;
  const query = before.slice(atOffset + 1);
  if (/\s/.test(query)) return null;
  return { textNode, atOffset, query };
}

/**
 * Anchors the popup's *bottom* just above the caret, so it opens upward and
 * grows upward as rows come in: RigPanel puts this composer at the bottom of
 * a 420px column with almost nothing below it. Like SelectionToolbar's
 * floatingPosition, this is captured once rather than re-anchored on scroll.
 */
export function popupStyleFor(rect: DOMRect): CSSProperties {
  const maxLeft = window.innerWidth - POPUP_WIDTH - VIEWPORT_MARGIN;
  return {
    left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft)),
    bottom: window.innerHeight - rect.top + POPUP_GAP,
    width: POPUP_WIDTH,
  };
}
