import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { resolveSelectionOffsets } from "~/domain/paragraph/resolveSelectionOffset";

type Pending = {
  paragraphElement: HTMLElement;
  paragraphId: string;
  range: Range;
  rect: DOMRect;
};

type Composing = {
  paragraphId: string;
  excerpt: string;
  rect: DOMRect;
  body: string;
};

/**
 * Wraps a reading column: watches for a text selection inside one of its
 * paragraphs (each rendered with `data-paragraph-id`, from
 * ReadingParagraph) and offers a floating toolbar — Highlight, or write a
 * note — over it. Everything made this way is role/origin: hand — there's
 * no Rig yet to make the other kind.
 *
 * A selection spanning more than one paragraph is deliberately ignored
 * (the toolbar just doesn't appear): both Highlight and Entry anchor to
 * exactly one paragraphId.
 *
 * Known rough edge: the toolbar's position is captured once, from
 * getBoundingClientRect() at selection time. Scrolling before clicking it
 * leaves it visually behind. Not worth a scroll listener for M1.
 */
export function SelectionHighlighter({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [composing, setComposing] = useState<Composing | null>(null);
  const fetcher = useFetcher();

  useEffect(() => {
    function onSelectionChange() {
      // Once the note textarea has focus, leave `pending` alone: clicking
      // into a form control collapses (or just doesn't update)
      // window.getSelection() for the surrounding document, and reacting
      // to that here would clear the toolbar out from under someone
      // mid-sentence. `composing` is a frozen snapshot from here on —
      // it's cleared explicitly, by Save or Cancel, not by this listener.
      if (composing) return;

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setPending(null);
        return;
      }

      const range = selection.getRangeAt(0);
      const container = containerRef.current;
      if (!container || !container.contains(range.commonAncestorContainer)) {
        setPending(null);
        return;
      }

      const anchor =
        range.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? range.commonAncestorContainer.parentElement
          : (range.commonAncestorContainer as Element);
      const paragraphElement = anchor?.closest<HTMLElement>("[data-paragraph-id]") ?? null;
      const paragraphId = paragraphElement?.dataset.paragraphId;
      if (!paragraphElement || !paragraphId) {
        setPending(null);
        return;
      }

      setPending({
        paragraphElement,
        paragraphId,
        range: range.cloneRange(),
        rect: range.getBoundingClientRect(),
      });
    }

    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [composing]);

  function handleHighlight(event: React.MouseEvent) {
    // mousedown, not click + preventDefault here: by the time a click
    // fires, the browser may already have collapsed the selection as part
    // of its default mousedown handling. Intercepting mousedown stops that.
    event.preventDefault();
    if (!pending) return;

    const offsets = resolveSelectionOffsets(pending.paragraphElement, pending.range);
    if (offsets) {
      fetcher.submit(
        {
          intent: "highlight",
          paragraphId: pending.paragraphId,
          startOffset: String(offsets.start),
          endOffset: String(offsets.end),
        },
        { method: "post" },
      );
    }
    window.getSelection()?.removeAllRanges();
    setPending(null);
  }

  function handleStartNote(event: React.MouseEvent) {
    event.preventDefault();
    if (!pending) return;
    const offsets = resolveSelectionOffsets(pending.paragraphElement, pending.range);
    const excerpt = offsets
      ? (pending.paragraphElement.textContent ?? "").slice(offsets.start, offsets.end)
      : (pending.paragraphElement.textContent ?? "");
    setComposing({ paragraphId: pending.paragraphId, excerpt, rect: pending.rect, body: "" });
    setPending(null);
  }

  function handleSaveNote() {
    if (!composing || composing.body.trim().length === 0) return;
    fetcher.submit(
      {
        intent: "note",
        paragraphId: composing.paragraphId,
        body: composing.body,
        excerpt: composing.excerpt,
      },
      { method: "post" },
    );
    window.getSelection()?.removeAllRanges();
    setComposing(null);
  }

  return (
    <div ref={containerRef} className="relative">
      {children}

      {pending && (
        <div
          className="fixed z-10 flex gap-2"
          style={{ left: pending.rect.left, top: pending.rect.top - 44 }}
        >
          <button type="button" onMouseDown={handleHighlight} className="btn btn-primary">
            Highlight
          </button>
          <button type="button" onMouseDown={handleStartNote} className="btn btn-secondary">
            Write a note
          </button>
        </div>
      )}

      {composing && (
        <div
          className="card elev-md fixed z-10 w-80"
          style={{ left: composing.rect.left, top: composing.rect.top - 44 }}
        >
          <textarea
            autoFocus
            className="input"
            rows={3}
            placeholder="Write in the margin…"
            value={composing.body}
            onChange={(e) => setComposing({ ...composing, body: e.target.value })}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setComposing(null)}
            >
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSaveNote}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
