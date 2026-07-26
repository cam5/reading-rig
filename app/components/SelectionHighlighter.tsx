import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { resolveSelectionOffsets } from "~/domain/paragraph/resolveSelectionOffset";

type Pending = {
  paragraphElement: HTMLElement;
  paragraphId: string;
  range: Range;
  rect: DOMRect;
};

/**
 * Wraps a reading column: watches for a text selection inside one of its
 * paragraphs (each rendered with `data-paragraph-id`, from
 * ReadingParagraph) and offers a floating button to turn it into a
 * Highlight. Everything made this way is role: hand — there's no Rig yet
 * to make the other kind.
 *
 * A selection spanning more than one paragraph is deliberately ignored
 * (the button just doesn't appear): a Highlight anchors to exactly one
 * paragraphId, matching resolveSelectionOffsets' own scope.
 *
 * Known rough edge: the button's position is captured once, from
 * getBoundingClientRect() at selection time. Scrolling before clicking it
 * leaves it visually behind. Not worth a scroll listener for M1.
 */
export function SelectionHighlighter({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const fetcher = useFetcher();

  useEffect(() => {
    function onSelectionChange() {
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
  }, []);

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

  return (
    <div ref={containerRef} className="relative">
      {children}
      {pending && (
        <button
          type="button"
          onMouseDown={handleHighlight}
          className="btn btn-primary fixed z-10"
          style={{ left: pending.rect.left, top: pending.rect.top - 44 }}
        >
          Highlight
        </button>
      )}
    </div>
  );
}
