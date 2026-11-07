import { describe, expect, it } from "vitest";
import { formatLocator } from "../locator";
import { describeAnchor, formatShelfLocator } from "./anchorContext";

const paragraph = {
  ordinal: 3,
  section: {
    id: "section-4",
    ordinal: 4,
    chapter: {
      ordinal: 4,
      work: { id: "work-middlemarch", title: "Middlemarch" },
    },
  },
};

describe("describeAnchor", () => {
  it("flattens the paragraph → section → chapter → work chain", () => {
    expect(describeAnchor(paragraph)).toEqual({
      workId: "work-middlemarch",
      workTitle: "Middlemarch",
      sectionId: "section-4",
      chapterOrdinal: 4,
      sectionOrdinal: 4,
      paragraphOrdinal: 3,
      locator: formatLocator({ sectionLabel: "4", paragraphOrdinal: 3 }),
    });
  });

  it("keeps chapter and section ordinals distinct", () => {
    const anchor = describeAnchor({
      ...paragraph,
      section: {
        ...paragraph.section,
        ordinal: 7,
        chapter: { ...paragraph.section.chapter, ordinal: 2 },
      },
    });
    expect(anchor.chapterOrdinal).toBe(2);
    expect(anchor.sectionOrdinal).toBe(7);
    expect(anchor.locator).toBe("§7 ¶3");
  });
});

describe("formatShelfLocator", () => {
  it("prefixes the locator with the work title and chapter", () => {
    expect(formatShelfLocator(describeAnchor(paragraph))).toBe(
      "Middlemarch · Ch. 4 §4 ¶3",
    );
  });
});
