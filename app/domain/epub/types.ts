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
  /** A stable slug, not a database id — see deriveWorkId() in parseEpub.ts. */
  id: string;
  title: string;
  author: string | null;
  chapters: ParsedChapter[];
};
