import { useMemo } from "react";
import { mergeHighlightsIntoHtml, type HighlightRange } from "~/domain/paragraph/mergeHighlights";

type Props = {
  paragraph: { id?: string; html: string; text: string };
  highlights?: HighlightRange[];
  className?: string;
};

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
export function ReadingParagraph({ paragraph, highlights = [], className = "" }: Props) {
  const html = useMemo(
    () => (highlights.length > 0 ? mergeHighlightsIntoHtml(paragraph, highlights) : paragraph.html),
    [paragraph, highlights],
  );

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
