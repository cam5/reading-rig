import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { resolveContainerSelectionSpans } from "~/domain/paragraph/resolveContainerSelection";
import type { ElementSpan } from "~/domain/paragraph/resolveSelectionOffset";
import { nextPostureIndex, POSTURE_DESCRIPTIONS, POSTURE_LABELS, rankPostures } from "~/domain/postures";
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
  // Non-null for a note on a *fresh* spanning selection — there's no
  // Highlight yet for it to reference, so handleSaveNote creates both
  // together. Null for a note on a single paragraph, which stays a bare
  // Entry with no highlightId — annotating already implies nothing about
  // wanting a highlight too.
  spans: ElementSpan[] | null;
};

/**
 * #28's slash palette — a third, frozen snapshot alongside `pending` and
 * `composing`, same reasoning as `composing`'s own comment below: once
 * open, the palette holds its own `start`/`end`/`rect` rather than
 * tracking whatever `pending` is doing, so a stray `selectionchange`
 * (there shouldn't be one, since nothing here ever moves focus into a
 * form control, but the guard costs nothing) can't rug the palette out
 * from under an in-progress ↑↓/query interaction. `query`/`activeIndex`
 * are the only two fields that change after open, both driven by the
 * keydown handler below rather than by any focused `<input>` — the
 * design's own mock has no text field in `#2b`, just a typed-into header
 * row, so this mirrors that rather than mounting a real input and
 * fighting it for focus/selection semantics. `start`/`end` come straight
 * off the single ElementSpan `pending` already resolved — no separate
 * Range to re-resolve later.
 */
type Palette = {
  paragraphElement: HTMLElement;
  paragraphId: string;
  start: number;
  end: number;
  rect: DOMRect;
  query: string;
  activeIndex: number;
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
 * model comment in schema.prisma), but a spanning note reaches further by
 * pointing at a Highlight's own spans instead — one created together with
 * the note, in the same request, since there's nothing to point at yet.
 * A single-paragraph note skips that: it stays a bare Entry with no
 * highlightId, same as before.
 *
 * `pending` holds already-resolved spans, not the raw Range — resolved
 * once in the selectionchange listener via resolveSelectionSpans, which
 * also trims a triple click's phantom reach into the next paragraph (a
 * real browser quirk: its endContainer can land at that paragraph's
 * offset 0 even though nothing there was selected). Resolving eagerly,
 * rather than re-deriving from paragraph elements + range at click time,
 * is what makes that trimming safe to rely on later.
 *
 * #28 adds a third consumer of the same selection-resolution machinery:
 * typing "/" while `pending` resolves to exactly one paragraph opens the
 * slash palette instead of (not in place of) that toolbar — ↑↓
 * ranks/holds a posture, ⏎ asks through the same `/rig/:workId` POST
 * #27's lens rail uses (now carrying the anchoring paragraphId/offsets
 * alongside posture + message), esc dismisses and clears the selection.
 * `workId` only exists as a prop because of this: Highlight/note post to
 * the current route's own action (no `action` prop on that
 * fetcher.submit), but the Rig lives at a different route entirely.
 *
 * A `pending` spanning more than one paragraph still gets the toolbar
 * (that's the multi-paragraph highlight case above) but "/" is a no-op
 * for it: the palette's anchor, like Entry's, resolves to exactly one
 * paragraphId, so it just doesn't open.
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
export function SelectionHighlighter({ children, workId }: { children: ReactNode; workId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [composing, setComposing] = useState<Composing | null>(null);
  const [palette, setPalette] = useState<Palette | null>(null);
  const fetcher = useFetcher();

  useEffect(() => {
    function onSelectionChange() {
      // Once the note textarea has focus, leave `pending` alone: clicking
      // into a form control collapses (or just doesn't update)
      // window.getSelection() for the surrounding document, and reacting
      // to that here would clear the toolbar out from under someone
      // mid-sentence. `composing` is a frozen snapshot from here on —
      // it's cleared explicitly, by Save or Cancel, not by this listener.
      // `palette` gets the same treatment for the same reason, even though
      // nothing moves focus while it's open (see Palette's own comment).
      if (composing || palette) return;

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
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [composing, palette]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (palette) {
        if (event.key === "Escape") {
          event.preventDefault();
          window.getSelection()?.removeAllRanges();
          setPalette(null);
          return;
        }

        const ranked = rankPostures(palette.query);

        if (event.key === "Enter") {
          event.preventDefault();
          const posture = ranked[palette.activeIndex];
          if (posture) {
            const excerpt = (palette.paragraphElement.textContent ?? "").slice(palette.start, palette.end);
            // Same path #27's lens rail "Ask" box submits through — POST
            // to /rig/:workId with `message` + `posture` — now also
            // carrying the anchoring paragraphId/offsets #8's selection
            // machinery already resolved. `message` is the selected
            // excerpt itself: the palette has no separate question
            // field to type into (matching the design's #2b mock, which
            // shows no text box), so the excerpt *is* the question —
            // "attend to this, in this posture."
            fetcher.submit(
              {
                message: excerpt,
                posture,
                paragraphId: palette.paragraphId,
                startOffset: String(palette.start),
                endOffset: String(palette.end),
              },
              { method: "post", action: `/rig/${workId}` },
            );
          }
          window.getSelection()?.removeAllRanges();
          setPalette(null);
          return;
        }

        // Reuses the lens rail's own arrow-key math (#27) over however
        // many postures the current query ranks/keeps — nextPostureIndex
        // is already generic over `length`, so a filtered-down list just
        // works, including wrapping and Home/End.
        const nextIndex = nextPostureIndex(palette.activeIndex, event.key, ranked.length);
        if (nextIndex !== null) {
          event.preventDefault();
          setPalette({ ...palette, activeIndex: nextIndex });
          return;
        }

        if (event.key === "Backspace") {
          event.preventDefault();
          setPalette({ ...palette, query: palette.query.slice(0, -1), activeIndex: 0 });
          return;
        }

        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          setPalette({ ...palette, query: palette.query + event.key, activeIndex: 0 });
          return;
        }

        return;
      }

      if (!pending || composing) return;
      if (event.key !== "/") return;
      // The palette's anchor, like Entry's, resolves to exactly one
      // paragraphId — a spanning `pending` still gets the toolbar (see
      // this component's own doc comment) but "/" is a no-op for it.
      if (pending.spans.length !== 1) return;

      // Don't hijack "/" typed into an actual form control elsewhere on
      // the page (the "Start a thread…" input, the "Ask" textarea) — in
      // practice clicking into one of those already collapses the window
      // selection and clears `pending` via onSelectionChange above, but
      // this is a cheap second guard against the one case that doesn't
      // (typing "/" via a synthetic/programmatic focus change that leaves
      // the selection intact).
      const target = event.target;
      if (target instanceof HTMLElement && ["input", "textarea"].includes(target.tagName.toLowerCase())) {
        return;
      }

      event.preventDefault();
      const [span] = pending.spans;
      const paragraphElement = span.element as HTMLElement;
      setPalette({
        paragraphElement,
        paragraphId: paragraphElement.dataset.paragraphId!,
        start: span.start,
        end: span.end,
        rect: pending.rect,
        query: "",
        activeIndex: 0,
      });
      setPending(null);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pending, composing, palette, fetcher, workId]);

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
    if (!pending) return;

    if (pending.spans.length === 1) {
      const [span] = pending.spans;
      const paragraphElement = span.element as HTMLElement;
      const paragraphId = paragraphElement.dataset.paragraphId!;
      const excerpt = (paragraphElement.textContent ?? "").slice(span.start, span.end);
      setComposing({ paragraphId, excerpt, rect: pending.rect, body: "", spans: null });
    } else {
      // No Highlight exists yet for a fresh spanning selection —
      // handleSaveNote creates one alongside the note itself. The
      // excerpt is stitched the same way read.tsx's sidebar reconstructs
      // a Highlight's text: each span's own slice, joined with " ".
      const excerpt = pending.spans
        .map((span) => (span.element.textContent ?? "").slice(span.start, span.end))
        .join(" ");
      const firstParagraphId = (pending.spans[0].element as HTMLElement).dataset.paragraphId!;
      setComposing({ paragraphId: firstParagraphId, excerpt, rect: pending.rect, body: "", spans: pending.spans });
    }
    setPending(null);
  }

  function handleSaveNote() {
    if (!composing || composing.body.trim().length === 0) return;

    if (composing.spans) {
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
    } else {
      fetcher.submit(
        {
          intent: "note",
          paragraphId: composing.paragraphId,
          body: composing.body,
          excerpt: composing.excerpt,
        },
        { method: "post" },
      );
    }
    window.getSelection()?.removeAllRanges();
    setComposing(null);
  }

  return (
    <div ref={containerRef} className="relative flex min-h-0 flex-1">
      {children}

      {pending && (
        <SelectionToolbar rect={pending.rect} onHighlight={handleHighlight} onStartNote={handleStartNote} />
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

      {palette && (() => {
        const ranked = rankPostures(palette.query);
        return (
          <div
            className="card elev-md fixed z-10 w-80 overflow-hidden p-0"
            style={{ left: palette.rect.left, top: palette.rect.top - 44 }}
            data-testid="slash-palette"
          >
            <div className="flex items-center gap-2 border-b border-divider px-4 py-3">
              <span className="font-heading text-[15px] text-[var(--color-accent)]">/</span>
              <span className="text-[13.5px]">{palette.query}</span>
              <span className="h-[15px] w-px bg-[var(--color-accent)]" />
              <span className="ml-auto text-[10px] uppercase tracking-wide opacity-45">on selection</span>
            </div>
            <ul>
              {ranked.length === 0 && (
                <li className="px-4 py-3 text-[12px] opacity-50">No posture matches &ldquo;{palette.query}&rdquo;</li>
              )}
              {ranked.map((posture, index) => (
                <li
                  key={posture}
                  data-testid="slash-palette-item"
                  data-posture={posture}
                  className="flex items-baseline gap-2.5 px-4 py-2.5"
                  style={index === palette.activeIndex ? { background: "var(--color-accent-100)" } : undefined}
                >
                  <span className="font-heading text-[14px]">{POSTURE_LABELS[posture]}</span>
                  <span className="text-[11.5px] opacity-55">{POSTURE_DESCRIPTIONS[posture]}</span>
                </li>
              ))}
            </ul>
            <div className="border-t border-divider px-4 py-2 text-[10.5px] tracking-wide opacity-40">
              ↑↓ to choose · ⏎ to ask · esc to keep reading
            </div>
          </div>
        );
      })()}
    </div>
  );
}
