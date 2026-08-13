import { useMemo } from "react";
import { mergeHighlightsIntoHtml, type HighlightRange } from "~/domain/paragraph/mergeHighlights";

type Props = {
  paragraph: {
    id?: string;
    html: string;
    text: string;
    isBlockquote?: boolean;
    isSceneBreak?: boolean;
  };
  highlights?: HighlightRange[];
  className?: string;
  /** React 19 passes `ref` as an ordinary prop to function components — no
   * `forwardRef` wrapper needed. The virtualized reading column
   * (useVirtualizedRows) uses this to measure each mounted paragraph's
   * real height once it's rendered. */
  ref?: React.Ref<HTMLParagraphElement>;
};

// A stable reference for the no-highlights default, so omitting `highlights`
// doesn't hand useMemo a fresh `[]` (and a false-positive dependency change)
// on every render.
const NO_HIGHLIGHTS: HighlightRange[] = [];

/**
 * Renders one paragraph's sanitised HTML — the reading surface's own
 * voice, hence `font-reading` (Literata) rather than the interface's
 * Figtree. Size/leading/spacing match the canvas's reading column (1c):
 * 17.5px/1.8, a 20px gap between paragraphs.
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
export function ReadingParagraph({ paragraph, highlights = NO_HIGHLIGHTS, className = "", ref }: Props) {
  const html = useMemo(() => {
    if (paragraph.isSceneBreak) return "";
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
      console.error(`ReadingParagraph: falling back to unhighlighted text for ${paragraph.id ?? "(no id)"}`, error);
      return paragraph.html;
    }
  }, [paragraph, highlights]);

  // A scene break (source <hr/>, see #139) carries no text of its own — it
  // marks a position in ordinal sequence, not prose to read. Rendered as a
  // glyph rather than dangerouslySetInnerHTML'd like every other row so it
  // stays measurable by the same ref the virtualized column relies on.
  if (paragraph.isSceneBreak) {
    return (
      <div
        ref={ref}
        id={paragraph.id}
        data-paragraph-id={paragraph.id}
        className={["mb-5 text-center text-[15px] tracking-[0.3em] opacity-50", className]
          .filter(Boolean)
          .join(" ")}
      >
        ⁂
      </div>
    );
  }

  return (
    <p
      ref={ref}
      id={paragraph.id}
      data-paragraph-id={paragraph.id}
      className={[
        "font-reading text-[17.5px] leading-[1.8] mb-5",
        paragraph.isBlockquote ? "pl-5 border-l-2 border-divider italic" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
