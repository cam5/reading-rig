import { formatLocator } from "../locator";

/**
 * The shared shape of "a paragraph, described via its section/chapter/work
 * chain" — enough to build a locator, a shelf-wide "which book" string, or
 * a jump link, without re-walking `paragraph.section.chapter.work` by hand
 * at each call site.
 */
export type AnchorContext = {
  workId: string;
  workTitle: string;
  sectionId: string;
  chapterOrdinal: number;
  sectionOrdinal: number;
  paragraphOrdinal: number;
  /** e.g. "§4 ¶3" — this paragraph alone, no book/chapter context. */
  locator: string;
};

type AnchorParagraph = {
  ordinal: number;
  section: {
    id: string;
    ordinal: number;
    chapter: {
      ordinal: number;
      work: { id: string; title: string };
    };
  };
};

export function describeAnchor(paragraph: AnchorParagraph): AnchorContext {
  const { section } = paragraph;
  const { chapter } = section;
  const { work } = chapter;
  return {
    workId: work.id,
    workTitle: work.title,
    sectionId: section.id,
    chapterOrdinal: chapter.ordinal,
    sectionOrdinal: section.ordinal,
    paragraphOrdinal: paragraph.ordinal,
    locator: formatLocator({
      sectionLabel: String(section.ordinal),
      paragraphOrdinal: paragraph.ordinal,
    }),
  };
}

/**
 * "Middlemarch · Ch. 4 §4 ¶3" — an `AnchorContext`'s locator, prefixed
 * with which book and chapter it's in. Needed anywhere a view spans more
 * than one work (commonplace's shelf-wide list and single-entry page);
 * read.tsx never needs it since it only ever shows one book at a time.
 */
export function formatShelfLocator(anchor: AnchorContext): string {
  return `${anchor.workTitle} · Ch. ${anchor.chapterOrdinal} ${anchor.locator}`;
}
