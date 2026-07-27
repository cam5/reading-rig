import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { resolveSelectionSpans } from "~/domain/paragraph/resolveSelectionOffset";

type Pending = {
  paragraphElements: HTMLElement[];
  range: Range;
  rect: DOMRect;
};

function closestParagraph(node: Node): HTMLElement | null {
  const anchor = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  return anchor?.closest<HTMLElement>("[data-paragraph-id]") ?? null;
}

/**
 * Wraps a reading column: watches for a text selection inside one or more
 * of its paragraphs (each rendered with `data-paragraph-id`, from
 * ReadingParagraph) and offers a floating button to turn it into a
 * Highlight. Everything made this way is role: hand — there's no Rig yet
 * to make the other kind.
 *
 * A highlight can reach across paragraphs — that's the point of
 * resolveSelectionSpans — but not across a *section* boundary: only one
 * section's paragraphs are ever mounted inside this component at a time
 * (read.tsx renders one section per page), so there's nothing on either
 * side of that boundary for a selection to reach into. Not an artificial
 * cap, just what's on screen.
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

      // The selection's two ends can land in different paragraphs; resolve
      // each independently rather than relying on commonAncestorContainer,
      // which for a cross-paragraph selection is some shared wrapper, not
      // a paragraph itself.
      const startParagraph = closestParagraph(range.startContainer);
      const endParagraph = closestParagraph(range.endContainer);
      if (!startParagraph || !endParagraph) {
        setPending(null);
        return;
      }

      const allParagraphs = Array.from(container.querySelectorAll<HTMLElement>("[data-paragraph-id]"));
      const startIndex = allParagraphs.indexOf(startParagraph);
      const endIndex = allParagraphs.indexOf(endParagraph);
      if (startIndex === -1 || endIndex === -1) {
        setPending(null);
        return;
      }

      const [lo, hi] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];

      setPending({
        paragraphElements: allParagraphs.slice(lo, hi + 1),
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

    const spans = resolveSelectionSpans(pending.paragraphElements, pending.range);
    if (spans) {
      fetcher.submit(
        {
          intent: "highlight",
          spans: JSON.stringify(
            spans.map(({ element, start, end }) => ({
              paragraphId: (element as HTMLElement).dataset.paragraphId!,
              start,
              end,
            })),
          ),
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
