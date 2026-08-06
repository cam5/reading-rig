import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Passage } from "~/rig/tools/shared";
import { useParagraphMentions } from "~/rig/useParagraphMentions";
import { DisplayText } from "./DisplayText";
import { MentionSuggestions, optionId } from "./MentionSuggestions";
import { createPillElement, serializeComposer } from "./tokenPill";

type Props = {
  workId: string;
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

const POPUP_WIDTH = 340;
/** Breathing room between the caret and the popup's bottom edge. */
const POPUP_GAP = 6;
const VIEWPORT_MARGIN = 8;

/**
 * The Rig's message composer: a plain-text field that can also hold inline,
 * non-editable pills standing in for paragraphs you've read ("@" to search
 * them). What you see is what gets sent — a pill serialises to its passage
 * quoted in place (see serializeComposer).
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
  disabled = false,
  placeholder = "Write a line, or ask through the lens…",
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  /** Full passages for the pills currently in the document, keyed by
   * paragraph id. Kept beside the DOM rather than in a data attribute so
   * quotes and angle brackets in a paragraph never have to survive a round
   * trip through HTML escaping. */
  const pillDataRef = useRef(new Map<string, Passage>());
  const mentionRangeRef = useRef<{ textNode: Text; atOffset: number } | null>(null);

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [popupStyle, setPopupStyle] = useState<CSSProperties | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [empty, setEmpty] = useState(true);

  const listboxId = useId();
  const { suggestions, loading } = useParagraphMentions(workId, mentionQuery);
  const popupOpen = mentionQuery !== null && popupStyle !== null && !disabled;
  const activePassage = suggestions[activeIndex];

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
      pillDataRef.current.delete(pill.dataset.paragraphId ?? "");
      pill.remove();
      refresh();
    }

    root.addEventListener("input", handleInput);
    root.addEventListener("beforeinput", handleBeforeInput);
    return () => {
      root.removeEventListener("input", handleInput);
      root.removeEventListener("beforeinput", handleBeforeInput);
    };
  }, []);

  function insertPill(passage: Passage) {
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
    mentionText.splitText(Math.max(caretOffset - atOffset, 0));
    const parent = mentionText.parentNode;
    if (!parent) return;

    const pill = createPillElement(passage);
    parent.replaceChild(pill, mentionText);
    pillDataRef.current.set(passage.paragraphId, passage);

    // Where the caret goes against an atomic contenteditable=false node is
    // inconsistent across browsers; an empty text node of our own gives it
    // somewhere unambiguous to sit.
    const caretHome = document.createTextNode("");
    parent.insertBefore(caretHome, pill.nextSibling);
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
      if (activePassage && ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab")) {
        event.preventDefault();
        insertPill(activePassage);
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
        aria-activedescendant={popupOpen && activePassage ? optionId(activePassage.paragraphId) : undefined}
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
            onSelect={insertPill}
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
  // Step over the empty text nodes insertPill parks after each pill.
  while (previous?.nodeType === Node.TEXT_NODE && !previous.textContent) {
    previous = previous.previousSibling;
  }
  if (previous instanceof HTMLElement && previous.dataset.paragraphId && root.contains(previous)) {
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
