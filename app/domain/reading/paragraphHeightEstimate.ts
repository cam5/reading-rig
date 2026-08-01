// Pre-hydration spacer sizing for the virtualized reading column
// (useVirtualizedRows) — only used until its ResizeObserver measures a
// paragraph's real rendered height. A flat guess works fine for paragraphs
// near the average length, but a one-line paragraph and a fifteen-line one
// both getting the same spacer height is exactly the kind of mismatch that
// shows up as a layout shift once real content replaces the guess. This
// keys the guess off the paragraph's own character count instead.

// Reading column: app/routes/read.tsx wraps ReadingParagraph in
// `mx-auto max-w-[660px]` — the actual width paragraph text wraps at.
const READING_COLUMN_WIDTH_PX = 660;

// Matches ReadingParagraph.tsx's `font-reading text-[17.5px] leading-[1.8]`.
const READING_FONT_SIZE_PX = 17.5;
const READING_LINE_HEIGHT_MULTIPLIER = 1.8;

// ReadingParagraph.tsx's `mb-5`. Tailwind's *default* spacing scale would
// make this 20px (5 × 4px), but this app's theme
// (app/styles/organic.css's @theme block) overrides Tailwind's own
// `--spacing` multiplier to 4.4px to match Organic's density — so mb-5
// actually renders at 5 × 4.4px = 22px here, not the default. Confirmed by
// reading that file rather than assumed from Tailwind's own docs.
const PARAGRAPH_MARGIN_BOTTOM_PX = 22;

// Average rendered width of one character, as a fraction of the font size
// ("em"), for Literata (a serif reading face) set as running prose: narrow
// letters (i, l, t) and wide ones (m, w) roughly average out to a bit
// over half an em per character. 0.52 is the middle of that typical
// 0.5–0.55 range for serif body text.
const AVERAGE_CHAR_WIDTH_EM = 0.52;

/**
 * A pre-hydration height guess for one paragraph, in px, from its plain
 * text — the spacer size `useVirtualizedRows` uses for a row before its
 * ResizeObserver reports the real rendered height. Wraps text at
 * `READING_COLUMN_WIDTH_PX` using an average character width, rounds up to
 * whole lines (a partial line still occupies a full line's height), and
 * adds back the paragraph's own bottom margin the same way
 * `useVirtualizedRows`' `occupiedHeight` does for the real, measured
 * element. Never fewer than one line, even for an empty paragraph.
 */
export function estimateParagraphHeightPx(text: string): number {
  const charWidthPx = READING_FONT_SIZE_PX * AVERAGE_CHAR_WIDTH_EM;
  const charsPerLine = READING_COLUMN_WIDTH_PX / charWidthPx;
  const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
  const lineHeightPx = READING_FONT_SIZE_PX * READING_LINE_HEIGHT_MULTIPLIER;
  return lines * lineHeightPx + PARAGRAPH_MARGIN_BOTTOM_PX;
}
