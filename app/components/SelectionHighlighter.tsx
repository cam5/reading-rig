import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { resolveSelectionSpans, type ElementSpan } from "~/domain/paragraph/resolveSelectionOffset";

type Pending = {
  spans: ElementSpan[];
  rect: DOMRect;
};

type Composing = {
  paragraphId: string;
  excerpt: string;
  rect: DOMRect;
  body: string;
};

function closestParagraph(node: Node): HTMLElement | null {
  const anchor = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  return anchor?.closest<HTMLElement>("[data-paragraph-id]") ?? null;
}

/**
 * Wraps a reading column: watches for a text selection inside one or more
 * of its paragraphs (each rendered with `data-paragraph-id`, from
 * ReadingParagraph) and offers a floating toolbar — Highlight, or write a
 * note — over it. Everything made this way is role/origin: hand — there's
 * no Rig yet to make the other kind.
 *
 * A highlight can reach across paragraphs — that's the point of
 * resolveSelectionSpans — but not across a *section* boundary: only one
 * section's paragraphs are ever mounted inside this component at a time
 * (read.tsx renders one section per page), so there's nothing on either
 * side of that boundary for a selection to reach into. Not an artificial
 * cap, just what's on screen.
 *
 * A note stays narrower on purpose: Entry anchors to exactly one
 * paragraphId (see the model comment in schema.prisma), so "Write a note"
 * only appears when the selection is within a single paragraph — a
 * spanning selection can still be highlighted, just not annotated, until
 * Entry can point at a Highlight's own spans instead of one paragraph.
 *
 * `pending` holds already-resolved spans, not the raw Range — resolved
 * once in the selectionchange listener via resolveSelectionSpans, which
 * also trims a triple click's phantom reach into the next paragraph (a
 * real browser quirk: its endContainer can land at that paragraph's
 * offset 0 even though nothing there was selected). Resolving eagerly,
 * rather than re-deriving from paragraph elements + range at click time,
 * is what makes that trimming safe to rely on later.
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
      if (!container) {
        setPending(null);
        return;
      }

      // A triple click on the *last* paragraph in the column can carry
      // its selection past the end of our column entirely — the browser
      // extends the boundary to the start of whatever comes next in the
      // document, which here is unrelated sidebar content (the posture
      // rail), not another paragraph. Range guarantees startContainer
      // precedes endContainer in document order, so when only one side
      // is actually inside our column, the other clamps to that column's
      // own edge rather than the whole selection being dropped.
      const startInside = container.contains(range.startContainer);
      const endInside = container.contains(range.endContainer);
      if (!startInside && !endInside) {
        setPending(null);
        return;
      }

      const allParagraphs = Array.from(container.querySelectorAll<HTMLElement>("[data-paragraph-id]"));
      if (allParagraphs.length === 0) {
        setPending(null);
        return;
      }

      const startParagraph = startInside ? closestParagraph(range.startContainer) : allParagraphs[0];
      const endParagraph = endInside ? closestParagraph(range.endContainer) : allParagraphs[allParagraphs.length - 1];
      if (!startParagraph || !endParagraph) {
        setPending(null);
        return;
      }

      const startIndex = allParagraphs.indexOf(startParagraph);
      const endIndex = allParagraphs.indexOf(endParagraph);
      if (startIndex === -1 || endIndex === -1) {
        setPending(null);
        return;
      }

      const [lo, hi] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
      const candidates = allParagraphs.slice(lo, hi + 1);

      // A clamped boundary is a synthetic "whole paragraph" edge (element
      // container, offset 0 or childNodes.length) rather than the real,
      // irrelevant container outside our column — boundaryToOffset
      // already resolves an element boundary that way.
      const effectiveRange = {
        startContainer: startInside ? range.startContainer : startParagraph,
        startOffset: startInside ? range.startOffset : 0,
        endContainer: endInside ? range.endContainer : endParagraph,
        endOffset: endInside ? range.endOffset : endParagraph.childNodes.length,
      };

      // Resolved here, once, rather than re-derived later from raw
      // paragraph elements + range: a triple click can also leave
      // range.endContainer sitting at offset 0 of the *next* paragraph (a
      // narrower version of the same quirk — functionally the same as
      // selecting the whole clicked paragraph), and resolveSelectionSpans
      // already trims that phantom reach. Re-resolving from a post-trim
      // element list later would fail, since the boundary container
      // wouldn't live inside it.
      const spans = resolveSelectionSpans(candidates, effectiveRange);
      if (!spans) {
        setPending(null);
        return;
      }

      setPending({ spans, rect: range.getBoundingClientRect() });
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

    fetcher.submit(
      {
        intent: "highlight",
        spans: JSON.stringify(
          pending.spans.map(({ element, start, end }) => ({
            paragraphId: (element as HTMLElement).dataset.paragraphId!,
            start,
            end,
          })),
        ),
      },
      { method: "post" },
    );
    window.getSelection()?.removeAllRanges();
    setPending(null);
  }

  function handleStartNote(event: React.MouseEvent) {
    event.preventDefault();
    // Entry anchors to exactly one paragraph — see the doc comment above —
    // so this button only ever renders (below) when pending.spans has
    // exactly one entry, but guard it here too rather than trust the UI.
    if (!pending || pending.spans.length !== 1) return;
    const [span] = pending.spans;
    const paragraphElement = span.element as HTMLElement;
    const paragraphId = paragraphElement.dataset.paragraphId!;
    const excerpt = (paragraphElement.textContent ?? "").slice(span.start, span.end);
    setComposing({ paragraphId, excerpt, rect: pending.rect, body: "" });
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
          {pending.spans.length === 1 && (
            <button type="button" onMouseDown={handleStartNote} className="btn btn-secondary">
              Write a note
            </button>
          )}
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
