import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { resolveContainerSelectionSpans } from "~/domain/paragraph/resolveContainerSelection";
import type { ElementSpan } from "~/domain/paragraph/resolveSelectionOffset";
import { NoteComposer } from "./NoteComposer";
import { SelectionToolbar } from "./SelectionToolbar";

type Pending = {
  spans: ElementSpan[];
  rect: DOMRect;
};

type Composing = {
  paragraphId: string;
  excerpt: string;
  rect: DOMRect;
  body: string;
  // A note made from a fresh selection always creates its own Highlight
  // alongside the Entry, in the same request (handleSaveNote submits
  // intent "highlight-note") — so the passage it's about is never left
  // unmarked. Distinct from MarginaliaSidebar's HighlightNoteComposer,
  // which attaches a note to a Highlight that already exists via a
  // separate "note" submission carrying an explicit highlightId, not spans.
  spans: ElementSpan[];
};

/**
 * Wraps a reading column: watches for a text selection inside one or more
 * of its paragraphs (each rendered with `data-paragraph-id`, from
 * ReadingParagraph) and offers a floating toolbar — Highlight, or write a
 * note — over it. Everything made this way is role/origin: hand — there's
 * no Rig yet to make the other kind.
 *
 * A highlight can reach across paragraphs — that's the point of
 * resolveSelectionSpans — including across a chapter/section boundary,
 * now that the whole work flows as one continuous column (#51): whatever
 * is actually mounted inside this component (querySelectorAll's own view
 * of the DOM) is the only real limit, not section membership. In
 * practice that's the virtualized window around the viewport
 * (useVirtualizedRows) — a selection can't reach a paragraph unmounted
 * far enough away that it was never visible to select in the first place.
 *
 * "Write a note" works on a spanning selection too, not just a single
 * paragraph: Entry still anchors to exactly one paragraphId (see the
 * model comment in schema.prisma), but a note reaches further by pointing
 * at a Highlight's own spans instead — one created together with the note,
 * in the same request (intent "highlight-note"), since there's nothing to
 * point at yet. That holds for a single-paragraph note too: the selection
 * becomes a highlight either way, so the note it anchors is never left
 * looking unattached in the reading column.
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
 *
 * The wrapper div is `flex min-h-0 flex-1`, not just `relative` — it has
 * to actually participate in the surrounding flex layout, not just anchor
 * absolute positioning. Its child (the scrollable reading column) needs
 * `flex-1`/`min-h-0` to be honored by a real flex *parent*, or the column
 * sizes to its own content instead of the available space and never
 * overflows — which means it never scrolls, which means #10's bookmark
 * tracker never fires. Caught by checking scrollHeight vs. clientHeight
 * in a real browser, not by any test.
 */
type Props = {
  children: ReactNode;
  /** Called with the pending selection's resolved spans (not yet a
   * Highlight — nothing is created here) when "Ask the Rig" is clicked.
   * Raw spans rather than an excerpt string: read.tsx needs each span's
   * paragraphId to build a locator, which this component has no paragraph
   * metadata of its own to do. */
  onAskRig: (spans: ElementSpan[]) => void;
  /** Called with the paragraphIds a save just touched, once its fetcher
   * resolves ok — lets the caller refresh them without a full reload. */
  onSaved: (paragraphIds: string[]) => void;
};

export function SelectionHighlighter({ children, onAskRig, onSaved }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [composing, setComposing] = useState<Composing | null>(null);
  const fetcher = useFetcher<{ ok: true }>();
  // Which paragraphIds the in-flight submission touched — set right before
  // fetcher.submit, read once the fetcher goes back to idle with data.
  // fetcher.data persists across the fetcher's whole lifetime (same caveat
  // MarginaliaSidebar's HighlightNoteComposer documents), so this ref, not
  // fetcher.data's mere presence, is what marks a save as "fresh to report".
  const pendingSaveRef = useRef<string[] | null>(null);

  useEffect(() => {
    if (
      fetcher.state !== "idle" ||
      !fetcher.data?.ok ||
      !pendingSaveRef.current
    )
      return;
    onSaved(pendingSaveRef.current);
    pendingSaveRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

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

      // The DOM/Range math — which paragraphs the selection touches, and
      // where within each — lives in resolveContainerSelectionSpans so it
      // can be tested as a plain function; see its doc comment for the
      // triple-click edge cases it handles.
      const spans = resolveContainerSelectionSpans(container, range);
      if (!spans) {
        setPending(null);
        return;
      }

      setPending({ spans, rect: range.getBoundingClientRect() });
    }

    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, [composing]);

  function handleHighlight(event: React.MouseEvent) {
    // mousedown, not click + preventDefault here: by the time a click
    // fires, the browser may already have collapsed the selection as part
    // of its default mousedown handling. Intercepting mousedown stops that.
    event.preventDefault();
    if (!pending) return;

    const paragraphIds = [
      ...new Set(
        pending.spans.map(
          (s) => (s.element as HTMLElement).dataset.paragraphId!,
        ),
      ),
    ];
    pendingSaveRef.current = paragraphIds;
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
    if (!pending) return;

    // The excerpt is stitched the same way read.tsx's sidebar reconstructs
    // a Highlight's text: each span's own slice, joined with " " (a
    // single-paragraph selection has just one span, so this is a no-op
    // join there).
    const excerpt = pending.spans
      .map((span) =>
        (span.element.textContent ?? "").slice(span.start, span.end),
      )
      .join(" ");
    const firstParagraphId = (pending.spans[0].element as HTMLElement).dataset
      .paragraphId!;
    setComposing({
      paragraphId: firstParagraphId,
      excerpt,
      rect: pending.rect,
      body: "",
      spans: pending.spans,
    });
    setPending(null);
  }

  function handleAskRig(event: React.MouseEvent) {
    event.preventDefault();
    if (!pending) return;
    onAskRig(pending.spans);
    setPending(null);
  }

  function handleSaveNote() {
    if (!composing || composing.body.trim().length === 0) return;

    const paragraphIds = [
      ...new Set(
        composing.spans.map(
          (s) => (s.element as HTMLElement).dataset.paragraphId!,
        ),
      ),
    ];
    pendingSaveRef.current = paragraphIds;
    fetcher.submit(
      {
        intent: "highlight-note",
        spans: JSON.stringify(
          composing.spans.map(({ element, start, end }) => ({
            paragraphId: (element as HTMLElement).dataset.paragraphId!,
            start,
            end,
          })),
        ),
        body: composing.body,
        excerpt: composing.excerpt,
      },
      { method: "post" },
    );
    window.getSelection()?.removeAllRanges();
    setComposing(null);
  }

  return (
    <div ref={containerRef} className="relative flex min-h-0 flex-1">
      {children}

      {pending && (
        <SelectionToolbar
          rect={pending.rect}
          onHighlight={handleHighlight}
          onStartNote={handleStartNote}
          onAskRig={handleAskRig}
        />
      )}

      {composing && (
        <NoteComposer
          rect={composing.rect}
          body={composing.body}
          onChange={(body) => setComposing({ ...composing, body })}
          onCancel={() => setComposing(null)}
          onSave={handleSaveNote}
        />
      )}
    </div>
  );
}
