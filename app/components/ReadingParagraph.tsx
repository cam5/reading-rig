import { useMemo } from "react";
import { mergeHighlightsIntoHtml, type HighlightRange } from "~/domain/paragraph/mergeHighlights";

type Props = {
  paragraph: { id?: string; html: string; text: string };
  highlights?: HighlightRange[];
  className?: string;
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
 */
export function ReadingParagraph({ paragraph, highlights = NO_HIGHLIGHTS, className = "" }: Props) {
  const html = useMemo(() => {
    if (highlights.length === 0) return paragraph.html;
    try {
      return mergeHighlightsIntoHtml(paragraph, highlights);
    } catch (error) {
      // mergeHighlightsIntoHtml throws on overlapping ranges rather than
      // guessing which highlight wins (see its own doc comment) — right
      // for a single paragraph, wrong for the whole reading page: falling
      // back to the plain sanitized html here means one paragraph with
      // bad data loses its highlight marks instead of taking every other
      // paragraph on the page down with it. The write path
      // (read.tsx's action) is what actually stops new overlaps from
      // being created; this is only a net for data that predates it.
      console.error(`ReadingParagraph: falling back to unhighlighted text for ${paragraph.id ?? "(no id)"}`, error);
      return paragraph.html;
    }
  }, [paragraph, highlights]);

  return (
    <p
      data-paragraph-id={paragraph.id}
      className={["font-reading text-[17.5px] leading-[1.8] mb-5", className]
        .filter(Boolean)
        .join(" ")}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
