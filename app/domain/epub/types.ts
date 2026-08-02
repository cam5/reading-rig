/**
 * The shape parseEpub() produces: a plain-object mirror of Work -> Chapter ->
 * Section -> Paragraph, before anything touches Prisma. Kept separate from
 * the database schema on purpose — this is what a pure, DB-free parser can
 * return and what app/domain/epub/*.test.ts can assert against directly.
 */

export type ParsedParagraph = {
  /** Content-addressed: stable across re-parsing the same file. See paragraphId.ts. */
  id: string;
  /** Sanitised inline HTML — the allow-listed subset from sanitizeHtml.ts. */
  html: string;
  /** Normalised plain text. Every offset (highlights, later) indexes into this. */
  text: string;
  /** The ¶N within its section. */
  ordinal: number;
  /** Monotonic across the whole work — the bookmark boundary indexes on this. */
  globalOrdinal: number;
  /** countWords(text) — persisted so progress/timeLeft math never needs
   * every paragraph's `text` in memory at once (see contentWindow.ts). */
  wordCount: number;
};

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
  /**
   * Specific, itemized things the parser wasn't fully confident about —
   * not a score. Empty means pristine: nothing ambiguous was encountered.
   * A non-empty entry names exactly what's uncertain and where, so a
   * reader can be told "N things to check" rather than a fabricated
   * confidence percentage with no principled basis.
   */
  warnings: string[];
};
