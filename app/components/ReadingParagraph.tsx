import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  mergeHighlightsIntoHtml,
  type HighlightRange,
} from "~/domain/paragraph/mergeHighlights";
import { FootnoteMarkerLazy } from "./FootnoteMarkerLazy";

type FootnoteData = { refId: string; html: string };

type Props = {
  paragraph: {
    id?: string;
    html: string;
    text: string;
    /** Defaults to "prose" when omitted — most paragraphs aren't a scene break. */
    kind?: "prose" | "sceneBreak";
    isBlockquote?: boolean;
    footnotes?: FootnoteData[];
  };
  highlights?: HighlightRange[];
  className?: string;
  /** True for a section's opening paragraph — print convention omits the
   * first-line indent there, since the divider/heading above it already
   * marks the break; only paragraphs *following* one within a section need
   * the indent as their break cue. */
  isFirstInSection?: boolean;
  /** React 19 passes `ref` as an ordinary prop to function components — no
   * `forwardRef` wrapper needed. The virtualized reading column
   * (useVirtualizedRows) uses this to measure each mounted paragraph's
   * real height once it's rendered. */
  ref?: React.Ref<HTMLParagraphElement>;
};

// A stable reference for the no-footnotes default, same reasoning as
// NO_HIGHLIGHTS below — most paragraphs have none.
const NO_FOOTNOTES: FootnoteData[] = [];

type FootnotePortal = {
  el: Element;
  refId: string;
  label: string;
  bodyHtml: string;
};

/** React 19 lets a caller pass any ref shape (object or callback) — this
 * component needs its own ref on the same DOM node (to find footnote
 * markers to portal into) without dropping whatever the caller passed
 * in for height measurement.
 *
 * Two things matter for a callback `outer` like useVirtualizedRows'
 * registerRowRef: its mount-time return value is a *cleanup* function
 * (React 19's ref-callback contract — see registerRowRef's own JSDoc),
 * and its identity has to stay stable across renders. Miss the first and
 * React falls back to calling `outer(null)` on unmount instead of
 * running that cleanup — registerRowRef's null-guard then skips
 * unobserving the ResizeObserver entirely, leaking every paragraph that
 * ever scrolls out of the window. Miss the second (a fresh arrow
 * function every render) and React detaches+reattaches — re-observing —
 * on every commit, not just real mount/unmount, which is enough on its
 * own to touch off a measure → correct → re-render → reattach loop.
 * `outer` is already memoized per row id by registerRowRef, so `[outer]`
 * is a genuinely stable dependency, not just a formality. */
function useMergedRef<T>(outer: React.Ref<T> | undefined) {
  const innerRef = useRef<T | null>(null);
  const setRef = useCallback(
    (node: T | null) => {
      innerRef.current = node;
      if (typeof outer === "function") return outer(node);
      if (outer) (outer as React.RefObject<T | null>).current = node;
    },
    [outer],
  );
  return { innerRef, setRef };
}

// A stable reference for the no-highlights default, so omitting `highlights`
// doesn't hand useMemo a fresh `[]` (and a false-positive dependency change)
// on every render.
const NO_HIGHLIGHTS: HighlightRange[] = [];

/**
 * Renders one paragraph's sanitised HTML — the reading surface's own
 * voice, hence `font-reading` (Literata) rather than the interface's
 * Figtree. Size/leading match the canvas's reading column (1c): 17.5px/1.8.
 * Paragraphs are set print-style — first-line indent, no gap between
 * them — so the indent is the only paragraph-break cue, same as a
 * printed page.
 *
 * `paragraph.html` is trusted input: it was sanitised once, at ingest
 * (app/domain/epub/sanitizeHtml.ts), to a narrow allow-list of inline
 * tags. This component (and mergeHighlightsIntoHtml, when highlights are
 * given) only ever adds `<mark>` wrappers around that trusted content —
 * neither takes an arbitrary string from anywhere else. Never pass
 * unsanitised HTML here.
 *
 * `id` doubles as the fragment `/commonplace/:entryId`'s "Open at the
 * passage" link scrolls to (`ScrollRestoration` emulates hash-link
 * scrolling on client navigation, same as a browser would on a full
 * load) — content-addressed paragraph ids are already unique and
 * HTML-id-safe, so no separate anchor scheme is needed.
 */
export function ReadingParagraph({
  paragraph,
  highlights = NO_HIGHLIGHTS,
  className = "",
  isFirstInSection = false,
  ref,
}: Props) {
  const { innerRef, setRef } = useMergedRef(ref);
  const footnotes = paragraph.footnotes ?? NO_FOOTNOTES;
  const [footnotePortals, setFootnotePortals] = useState<FootnotePortal[]>([]);

  const html = useMemo(() => {
    if (paragraph.kind === "sceneBreak") return "";
    if (highlights.length === 0) return paragraph.html;
    try {
      return mergeHighlightsIntoHtml(paragraph, highlights);
    } catch (error) {
      // mergeHighlightsIntoHtml has no defined throw path today (overlap
      // renders as nested marks, not an error — #48), but if something
      // else ever goes wrong here — malformed html/text pairing, say —
      // this stays a per-paragraph net rather than taking the whole
      // reading page down with it: falling back to the plain sanitized
      // html means one paragraph with bad data loses its highlight marks
      // instead of every other paragraph on the page failing too.
      console.error(
        `ReadingParagraph: falling back to unhighlighted text for ${paragraph.id ?? "(no id)"}`,
        error,
      );
      return paragraph.html;
    }
  }, [paragraph, highlights]);

  // dangerouslySetInnerHTML takes a fresh `{ __html }` object every render;
  // React's prop diff for it compares that wrapper, not the string inside,
  // so an unmemoized literal here reassigns the real DOM's innerHTML on
  // every re-render of this row (scroll-driven ones included) even when
  // `html` itself is unchanged. Every such reassignment throws away and
  // recreates the paragraph's real child nodes — including any
  // <sup data-footnote-ref> the effect below already portaled a footnote
  // marker into, orphaning that portal permanently since the effect's own
  // deps (html/footnotes, compared by value) never see a change and so
  // never rerun to re-portal into the replacement node. Memoizing the
  // wrapper keyed on `html` gives React a stable object when the string
  // hasn't changed, so it skips the DOM write entirely.
  const innerHtmlProp = useMemo(() => ({ __html: html }), [html]);

  // Finds the real <sup data-footnote-ref> elements sanitizeHtml.ts left
  // in the server-rendered html (see #138) and portals a FootnoteMarker
  // into each — clearing the marker's raw digit first, since the portal
  // renders its own copy alongside the popover. Runs after every commit
  // that changed `html` (a highlight merge can rebuild the DOM the
  // markers live in) or the footnote list itself.
  useLayoutEffect(() => {
    if (footnotes.length === 0 || !innerRef.current) {
      setFootnotePortals((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const byRefId = new Map(footnotes.map((f) => [f.refId, f]));
    const markers = Array.from(
      innerRef.current.querySelectorAll<HTMLElement>("sup[data-footnote-ref]"),
    );
    // `footnotes` is handed down fresh (new array identity) on most parent
    // re-renders even though its contents never change post-fetch, so this
    // effect fires far more often than `html` (the real DOM) does. Reusing
    // an already-portaled marker's existing entry — keyed by the marker's
    // own DOM node — is what makes that safe: a re-run against unchanged
    // DOM leaves already-cleared markers alone. A real `html` change
    // (highlight merge) rebuilds the DOM, so its markers are fresh nodes
    // this component has never seen and are (correctly) processed as new.
    //
    // The updater itself only reads the DOM (never mutates it) — React's
    // updater-purity contract means it may in principle be invoked more
    // than once per commit for the same base state, and an earlier version
    // of this effect that cleared `marker.textContent` inside the updater
    // would, on a second such invocation, read back its own already-empty
    // clear as the label. The actual clearing happens once below, after
    // state is committed, and is naturally idempotent (clearing an
    // already-empty node is a no-op) however many times *that* runs.
    setFootnotePortals((prev) => {
      const already = new Map(prev.map((portal) => [portal.el, portal]));
      const next: FootnotePortal[] = [];
      for (const marker of markers) {
        const existing = already.get(marker);
        if (existing) {
          next.push(existing);
          continue;
        }
        const refId = marker.getAttribute("data-footnote-ref");
        const footnote = refId ? byRefId.get(refId) : undefined;
        if (!footnote) continue;
        next.push({
          el: marker,
          refId: footnote.refId,
          label: marker.textContent ?? "",
          bodyHtml: footnote.html,
        });
      }
      return next;
    });
    for (const marker of markers) {
      if (marker.textContent) marker.textContent = "";
    }
    // innerRef is a ref, not reactive — html/footnotes are the real
    // triggers for "the DOM might have new markers to scan."
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, footnotes]);

  // A scene break (source <hr/>, see #139) carries no text of its own — it
  // marks a position in ordinal sequence, not prose to read. Rendered as a
  // glyph rather than dangerouslySetInnerHTML'd like every other row so it
  // stays measurable by the same ref the virtualized column relies on.
  if (paragraph.kind === "sceneBreak") {
    return (
      <div
        ref={ref}
        id={paragraph.id}
        data-paragraph-id={paragraph.id}
        className={[
          "mb-5 text-center text-[15px] tracking-[0.3em] opacity-50",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        ⁂
      </div>
    );
  }

  return (
    <>
      <p
        ref={setRef}
        id={paragraph.id}
        data-paragraph-id={paragraph.id}
        className={[
          "font-reading text-[17.5px] leading-[1.8] text-pretty text-justify mb-0!",
          paragraph.isBlockquote ? "pl-5 border-l-2 border-divider italic" : "",
          isFirstInSection ? "" : "indent-[3ch]",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        dangerouslySetInnerHTML={innerHtmlProp}
      />
      {footnotePortals.map((portal) =>
        createPortal(
          <FootnoteMarkerLazy
            key={portal.refId}
            label={portal.label}
            bodyHtml={portal.bodyHtml}
          />,
          portal.el,
        ),
      )}
    </>
  );
}
