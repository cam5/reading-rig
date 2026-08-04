import { useMemo } from "react";
import { mergeHighlightsIntoHtml, type HighlightRange } from "~/domain/paragraph/mergeHighlights";

type Props = {
  paragraph: { id?: string; html: string; text: string };
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
 * voice, hence `font-reading` (EB Garamond) rather than the interface's
 * Figtree.
 *
 * 20px/1.6, not Literata's old 17.5px/1.8 — EB Garamond needed its own
 * numbers, not a straight carry-over, once it replaced Literata. Measured
 * off the actual font files (not eyeballed): EB Garamond's x-height is
 * 0.40em vs Literata's 0.51em, and its glyphs average 0.49em wide vs
 * 0.57em — smaller *and* narrower. Bumping to 20px lands the 660px
 * reading column (read.tsx) back at ~66 characters per line — Bringhurst's
 * ideal measure, and what 17.5px/Literata was already hitting almost
 * exactly — while meaningfully closing the x-height gap (fully closing it
 * would mean ~22px, but that overshoots the measure). 1.6 line-height,
 * down from 1.8: Literata's own vertical metrics run unusually tall
 * (fonts.css), so its 1.8 was partly compensating for that; EB Garamond's
 * are more modest, and its fine hairlines read as disconnected rather than
 * airy past ~1.65. The paragraph gap (`mb-5`) is untouched — at the new
 * line-height it's still ~0.7 of a line, the same proportion as before.
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
      ref={ref}
      id={paragraph.id}
      data-paragraph-id={paragraph.id}
      className={["font-reading text-[20px] leading-[1.6] mb-5", className]
        .filter(Boolean)
        .join(" ")}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
