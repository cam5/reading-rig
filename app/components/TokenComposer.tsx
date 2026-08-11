import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { OnScreenExcerpt } from "~/domain/paragraph/onScreenExcerpt";
import { useMentionCandidates } from "~/rig/useMentionCandidates";
import { DisplayText } from "./DisplayText";
import { MentionSuggestions, optionId } from "./MentionSuggestions";
import { pillId, serializeComposer, type PillCandidate } from "./tokenPill";
import { collapseInto, caretRect, hasContent } from "./tokenComposerCaret";
import { readMentionAtCaret, popupStyleFor, type MentionAnchor } from "./tokenComposerMention";
import {
  pillBeforeCaret,
  insertPillAtMention,
  removePillBeforeCaret,
  insertLineBreakAtCaret,
} from "./tokenComposerEditing";

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
 * mutation goes through the DOM directly, via tokenComposerCaret.ts (raw
 * caret/selection queries) and tokenComposerEditing.ts (pill and line-break
 * DOM surgery); tokenComposerMention.ts owns spotting an in-progress "@query"
 * and placing the popup against it. This component wires those three
 * concerns to React's event and render cycle and otherwise stays out of the
 * DOM itself.
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
  const mentionRangeRef = useRef<MentionAnchor | null>(null);
  /** Suffixed onto pillId(candidate) to give each inserted pill its own
   * data-pill-id/pillDataRef key — see pillId's comment on why the same
   * candidate can otherwise collide with an earlier pill of itself. */
  const pillInsertCountRef = useRef(0);

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [popupStyle, setPopupStyle] = useState<CSSProperties | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [empty, setEmpty] = useState(true);
  /** Bumped on every document mutation (refresh, insertSuggestion, handleSend),
   * purely to invalidate the suggestions memo below against the live DOM.
   * Needed because the thing that memo has to notice — whether an onScreen
   * pill is still in the document — can change via a path with no code of
   * its own to run, like a select-all backspace; that's exactly the case a
   * hand-kept "has an onScreen pill" flag went permanently stale on before. */
  const [contentVersion, setContentVersion] = useState(0);

  const listboxId = useId();
  const { suggestions: candidates, loading } = useMentionCandidates(workId, mentionQuery);
  // The pinned "in view" row leads the list unless the message being
  // composed already has one — checked against the live DOM rather than a
  // separately tracked flag, so any way the pill leaves the document
  // un-gates the row again. The cap is per-message, not per-conversation:
  // handleSend clears the document, so the same pin is free to reappear in
  // the next message.
  const suggestions = useMemo<PillCandidate[]>(() => {
    const root = contentRef.current;
    const hasOnScreenPillInMessage =
      root != null &&
      Array.from(root.querySelectorAll<HTMLElement>("[data-pill-id]")).some(
        (pill) => pillDataRef.current.get(pill.dataset.pillId ?? "")?.kind === "onScreen",
      );
    if (onScreenExcerpt && !hasOnScreenPillInMessage) {
      return [{ kind: "onScreen", excerpt: onScreenExcerpt }, ...candidates];
    }
    return candidates;
  }, [candidates, onScreenExcerpt, contentVersion]);
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
    setContentVersion((v) => v + 1);
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
      pillDataRef.current.delete(id);
      removePillBeforeCaret(pill);
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
    const anchor = mentionRangeRef.current;
    if (!root || !anchor) return;
    const instanceId = `${pillId(candidate)}#${pillInsertCountRef.current++}`;
    insertPillAtMention(root, anchor, mentionQuery?.length ?? 0, candidate, instanceId);
    pillDataRef.current.set(instanceId, candidate);
    closePopup();
    setEmpty(false);
    setContentVersion((v) => v + 1);
  }

  function insertLineBreak() {
    if (!contentRef.current) return;
    insertLineBreakAtCaret();
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
    setContentVersion((v) => v + 1);
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
