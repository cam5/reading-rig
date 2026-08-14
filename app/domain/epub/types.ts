/**
 * The shape parseEpub() produces: a plain-object mirror of Work -> Chapter ->
 * Section -> Paragraph, before anything touches Prisma. Kept separate from
 * the database schema on purpose — this is what a pure, DB-free parser can
 * return and what app/domain/epub/*.test.ts can assert against directly.
 */

/** Mirrors the Prisma `ParagraphKind` enum — kept as a plain union rather
 * than imported from the generated client, since this file is deliberately
 * DB-free (see file header). */
export type ParagraphKind = "prose" | "sceneBreak";

type ParsedParagraphCommon = {
  /** Content-addressed: stable across re-parsing the same file. See paragraphId.ts. */
  id: string;
  /** The ¶N within its section. */
  ordinal: number;
  /** Monotonic across the whole work — the bookmark boundary indexes on this. */
  globalOrdinal: number;
};

export type ParsedProseParagraph = ParsedParagraphCommon & {
  kind: "prose";
  /** Sanitised inline HTML — the allow-listed subset from sanitizeHtml.ts. */
  html: string;
  /** Normalised plain text. Every offset (highlights, later) indexes into this. */
  text: string;
  /** countWords(text) — persisted so progress/timeLeft math never needs
   * every paragraph's `text` in memory at once (see contentWindow.ts). */
  wordCount: number;
  /** Source was a <p> nested inside a <blockquote> (a letter, a quoted
   * document) rather than direct chapter prose — html/text/wordCount are
   * still real content, this only changes how the reader renders it. */
  isBlockquote: boolean;
};

/** A source <hr> scene break (see #139). Not addressable content — it
 * exists only to hold its place in ordinal sequence so the paragraphs on
 * either side don't silently concatenate; there is no text to highlight,
 * annotate, or mention against. */
export type ParsedSceneBreak = ParsedParagraphCommon & {
  kind: "sceneBreak";
};

export type ParsedParagraph = ParsedProseParagraph | ParsedSceneBreak;

export type ParsedSection = {
  /** The "4" in "§4" — a label, not assumed numeric (see domain/locator.ts). */
  label: string;
  /** Position within the chapter. */
  ordinal: number;
  paragraphs: ParsedParagraph[];
};

export type ParsedChapter = {
  /** Display label, e.g. "Chapter 1: The Commodity". */
  label: string;
  /** Position within the work's spine. */
  ordinal: number;
  sections: ParsedSection[];
};

/**
 * One footnote/endnote body, joined against the paragraph whose <sup
 * data-footnote-ref> marker points at it — see #138 and
 * sanitizeHtml.ts's rewriteFootnoteRefs/sanitizeFootnoteBody.
 */
export type ParsedFootnote = {
  /** The paragraph containing the `data-footnote-ref="refId"` marker. */
  paragraphId: string;
  /** Matches the marker's data-footnote-ref, e.g. "note-1". */
  refId: string;
  /** Sanitised block-content HTML (FOOTNOTE_BODY_ALLOWED_TAGS) — wider
   * than a paragraph's, since a footnote body is often more than one
   * inline line. */
  html: string;
  text: string;
  /** Reading-order position across the whole work. */
  ordinal: number;
};

export type ParsedWork = {
  /**
   * A stable slug plus a hash of the source edition's bytes — see
   * deriveWorkId() and hashEdition() in parseEpub.ts. Not a database id
   * assigned at persist time; a revised edition of the same book forks
   * onto a new id rather than colliding with the one already annotated.
   */
  id: string;
  title: string;
  author: string | null;
  chapters: ParsedChapter[];
  footnotes: ParsedFootnote[];
  /**
   * Specific, itemized things the parser wasn't fully confident about —
   * not a score. Empty means pristine: nothing ambiguous was encountered.
   * A non-empty entry names exactly what's uncertain and where, so a
   * reader can be told "N things to check" rather than a fabricated
   * confidence percentage with no principled basis.
   */
  warnings: string[];
};
