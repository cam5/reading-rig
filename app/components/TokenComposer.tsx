import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { OnScreenExcerpt } from "~/domain/paragraph/onScreenExcerpt";
import { useMentionCandidates } from "~/rig/useMentionCandidates";
import { DisplayText } from "./DisplayText";
import { MentionSuggestions, optionId } from "./MentionSuggestions";
import { createPillElement, pillId, serializeComposer, type PillCandidate } from "./tokenPill";

type Props = {
  workId: string;
  onSend: (text: string) => void;
  /** Whatever's currently on screen in the reading column, as of the most
   * recent scroll-settle — the composer's pinned "in view" suggestion
   * (#117 follow-up). `null` before the first settle, or if nothing's
   * mounted yet to build one from. */
  onScreenExcerpt: OnScreenExcerpt | null;
  disabled?: boolean;
  placeholder?: string;
};

const POPUP_WIDTH = 340;
/** Breathing room between the caret and the popup's bottom edge. */
const POPUP_GAP = 6;
const VIEWPORT_MARGIN = 8;

/**
 * The Rig's message composer: a plain-text field that can also hold inline,
 * non-editable pills standing in for a paragraph, a note, or the passage
 * currently on screen ("@" to search the first two; the third is pinned at
 * the top of the same popup, #117 follow-up). What you see is what gets
 * sent — a pill serialises to its source text quoted in place (see
 * serializeComposer).
 *
 * The contentEditable is deliberately *uncontrolled*: its DOM is the only
 * record of what's been typed, and nothing here ever renders that content
 * from React state, because re-rendering a contentEditable's subtree drops
 * the caret. React state below is strictly popup chrome — is it open, where,
 * which row is active, what's been typed after the "@" — and every content
 * mutation goes through the DOM directly.
 */
export function TokenComposer({
  workId,
  onSend,
  onScreenExcerpt,
  disabled = false,
  placeholder = "Write a line, or ask through the lens…",
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  /** Full candidates for the pills currently in the document, keyed by pill
   * id. Kept beside the DOM rather than in a data attribute so quotes and
   * angle brackets in a paragraph or note never have to survive a round
   * trip through HTML escaping. */
  const pillDataRef = useRef(new Map<string, PillCandidate>());
  const mentionRangeRef = useRef<{ textNode: Text; atOffset: number } | null>(null);

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [popupStyle, setPopupStyle] = useState<CSSProperties | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [empty, setEmpty] = useState(true);
  // Mirrors whether pillDataRef currently holds an onScreen pill — tracked
  // by hand alongside every insertion/removal (same reasoning as `empty`:
  // pill insertion/removal happens outside the `input` event refresh() syncs
  // on, since it's DOM surgery this component does itself, not the browser).
  const [hasOnScreenPill, setHasOnScreenPill] = useState(false);

  const listboxId = useId();
  const { suggestions: candidates, loading } = useMentionCandidates(workId, mentionQuery);
  // The pinned "in view" row leads the list whenever there's something to
  // pin and the composer doesn't already hold one — inserting it removes
  // it from the popup rather than letting a second one be added, since (per
  // #117 follow-up's design) a pill is a snapshot taken once, not a live
  // reference, so a second one would only ever be a stale duplicate of the
  // first until the reader deletes it.
  const suggestions = useMemo<PillCandidate[]>(() => {
    if (onScreenExcerpt && !hasOnScreenPill) {
      return [{ kind: "onScreen", excerpt: onScreenExcerpt }, ...candidates];
    }
    return candidates;
  }, [candidates, onScreenExcerpt, hasOnScreenPill]);
  const popupOpen = mentionQuery !== null && popupStyle !== null && !disabled;
  const activeSuggestion = suggestions[activeIndex];

  useEffect(() => setActiveIndex(0), [suggestions]);

  function closePopup() {
    mentionRangeRef.current = null;
    setMentionQuery(null);
    setPopupStyle(null);
  }

  function syncMention(root: HTMLElement) {
    const mention = readMentionAtCaret(root);
    if (!mention) {
      closePopup();
      return;
    }
    mentionRangeRef.current = { textNode: mention.textNode, atOffset: mention.atOffset };
    setMentionQuery(mention.query);
    setPopupStyle(popupStyleFor(caretRect() ?? root.getBoundingClientRect()));
  }

  /** Everything that has to happen after the document changed, whoever
   * changed it. */
  function refresh() {
    const root = contentRef.current;
    if (!root) return;
    // Deleting the last character leaves a lone <br> behind in most browsers,
    // which would keep the composer off `:empty` and so hide the placeholder
    // for good.
    if (root.childNodes.length === 1 && root.firstChild?.nodeName === "BR") {
      root.replaceChildren();
      collapseInto(root, 0);
    }
    setEmpty(!hasContent(root));
    syncMention(root);
  }

  // Both of these are native events rather than React's synthetic ones:
  // `beforeinput` has no React equivalent that can cancel a deletion, and
  // contentEditable never fires the synthetic `change` that would stand in
  // for `input`. The handlers only ever touch refs and state setters, so
  // binding them once against the first render's closure stays correct.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    function handleInput() {
      refresh();
    }

    function handleBeforeInput(event: InputEvent) {
      if (event.inputType !== "deleteContentBackward") return;
      const selection = window.getSelection();
      if (!selection?.isCollapsed || selection.rangeCount === 0) return;
      const pill = pillBeforeCaret(selection.getRangeAt(0), root!);
      if (!pill) return;
      // A pill is one thing, not the string of characters it renders as.
      event.preventDefault();
      const id = pill.dataset.pillId ?? "";
      const removed = pillDataRef.current.get(id);
      pillDataRef.current.delete(id);
      // The caret's current node — the empty text node insertSuggestion
      // parks after every pill (see its own comment) — stays put once the
      // pill is gone, since removing a sibling doesn't move an existing
      // Range. Collapsing onto the end of whatever real text preceded the
      // pill instead, rather than leaving the caret in that now-pointless
      // empty node, is what the rest of this block depends on.
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
      if (removed?.kind === "onScreen") setHasOnScreenPill(false);
      refresh();
    }

    root.addEventListener("input", handleInput);
    root.addEventListener("beforeinput", handleBeforeInput);
    return () => {
      root.removeEventListener("input", handleInput);
      root.removeEventListener("beforeinput", handleBeforeInput);
    };
  }, []);

  function insertSuggestion(candidate: PillCandidate) {
    const root = contentRef.current;
    const mention = mentionRangeRef.current;
    if (!root || !mention) return;
    const { textNode, atOffset } = mention;

    const selection = window.getSelection();
    // The live caret is authoritative — the suggestion rows' onMouseDown
    // preventDefault keeps the selection on this very node — with the typed
    // query's length as the fallback for anything that moved it anyway.
    const caretOffset =
      selection?.isCollapsed && selection.anchorNode === textNode
        ? selection.anchorOffset
        : Math.min(atOffset + 1 + (mentionQuery?.length ?? 0), textNode.length);

    const mentionText = textNode.splitText(atOffset);
    const afterCaret = mentionText.splitText(Math.max(caretOffset - atOffset, 0));
    const parent = mentionText.parentNode;
    if (!parent) return;

    const pill = createPillElement(candidate);
    parent.replaceChild(pill, mentionText);
    pillDataRef.current.set(pillId(candidate), candidate);
    if (candidate.kind === "onScreen") setHasOnScreenPill(true);

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

    closePopup();
    setEmpty(false);
  }

  function insertLineBreak() {
    const root = contentRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return;
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
      caretHome.parentNode?.insertBefore(document.createElement("br"), caretHome.nextSibling);
    }
    collapseInto(caretHome, 0);
    closePopup();
  }

  function handleSend() {
    const root = contentRef.current;
    if (!root || disabled) return;
    const text = serializeComposer(root, pillDataRef.current);
    if (!text) return;
    onSend(text);
    root.innerHTML = "";
    pillDataRef.current.clear();
    setEmpty(true);
    closePopup();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (popupOpen) {
      if (event.key === "Escape") {
        // Closes the popup and nothing else: the "@query" stays as the plain
        // text it already is, caret untouched.
        event.stopPropagation();
        closePopup();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((index) =>
          suggestions.length === 0 ? 0 : (index + step + suggestions.length) % suggestions.length,
        );
        return;
      }
      // With no rows to take, Enter and Tab fall through to their ordinary
      // meanings rather than swallowing the keystroke.
      if (activeSuggestion && ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab")) {
        event.preventDefault();
        insertSuggestion(activeSuggestion);
        return;
      }
    }

    if (event.key !== "Enter") return;
    event.preventDefault();
    if (event.shiftKey) {
      insertLineBreak();
      return;
    }
    handleSend();
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    // Plain text only, always: a pill may only ever enter this field by way
    // of a real mention selection, never by pasting something shaped like one.
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    if (text) document.execCommand("insertText", false, text);
  }

  return (
    <div className="flex items-end gap-2">
      <div
        ref={contentRef}
        role="textbox"
        aria-multiline="false"
        aria-disabled={disabled || undefined}
        // The popup is portalled to <body>, so it isn't a descendant this
        // could point at implicitly.
        aria-owns={popupOpen ? listboxId : undefined}
        aria-activedescendant={popupOpen && activeSuggestion ? optionId(pillId(activeSuggestion)) : undefined}
        tabIndex={0}
        contentEditable={!disabled}
        className="input token-composer max-h-40 flex-1 overflow-y-auto break-words"
        data-placeholder={placeholder}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={closePopup}
      />
      <button
        type="button"
        className="btn btn-primary btn-icon"
        disabled={disabled || empty}
        onClick={handleSend}
        aria-label="Send"
      >
        <DisplayText text="→" />
      </button>
      {popupOpen &&
        createPortal(
          <MentionSuggestions
            suggestions={suggestions}
            activeIndex={activeIndex}
            loading={loading}
            onSelect={insertSuggestion}
            style={popupStyle}
            listboxId={listboxId}
          />,
          document.body,
        )}
    </div>
  );
}

/**
 * The mention being typed at the caret, if there is one. Scans backwards
 * within the caret's own Text node only — a pill is always its own sibling
 * node, so a mention typed straight after one starts in a fresh Text node
 * and there's never a reason to cross a boundary.
 */
function readMentionAtCaret(root: HTMLElement): { textNode: Text; atOffset: number; query: string } | null {
  const selection = window.getSelection();
  if (!selection?.isCollapsed) return null;
  const { anchorNode, anchorOffset } = selection;
  if (!anchorNode || anchorNode.nodeType !== Node.TEXT_NODE || !root.contains(anchorNode)) return null;

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

function caretRect(): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rect = range.getBoundingClientRect();
  // A collapsed range against an empty text node can measure as all zeroes;
  // the caller falls back to the composer's own box.
  return rect.top === 0 && rect.left === 0 ? null : rect;
}

/**
 * Anchors the popup's *bottom* just above the caret, so it opens upward and
 * grows upward as rows come in: RigPanel puts this composer at the bottom of
 * a 420px column with almost nothing below it. Like SelectionToolbar's
 * floatingPosition, this is captured once rather than re-anchored on scroll.
 */
function popupStyleFor(rect: DOMRect): CSSProperties {
  const maxLeft = window.innerWidth - POPUP_WIDTH - VIEWPORT_MARGIN;
  return {
    left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft)),
    bottom: window.innerHeight - rect.top + POPUP_GAP,
    width: POPUP_WIDTH,
  };
}

/** The pill the caret is sitting immediately after, if any. */
function pillBeforeCaret(range: Range, root: HTMLElement): HTMLElement | null {
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
  // Step over the empty text nodes insertSuggestion parks after each pill.
  while (previous?.nodeType === Node.TEXT_NODE && !previous.textContent) {
    previous = previous.previousSibling;
  }
  if (previous instanceof HTMLElement && previous.dataset.pillId && root.contains(previous)) {
    return previous;
  }
  return null;
}

/** Pills count: their label is part of textContent, so a message that's only
 * a quoted passage is still sendable. */
function hasContent(root: HTMLElement): boolean {
  return (root.textContent ?? "").trim().length > 0;
}

function hasContentAfter(node: Node): boolean {
  for (let next = node.nextSibling; next; next = next.nextSibling) {
    if (next.nodeType !== Node.TEXT_NODE || next.textContent) return true;
  }
  return false;
}

function collapseInto(node: Node, offset: number) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
