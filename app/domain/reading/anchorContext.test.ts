import { describe, expect, it } from "vitest";
import { describeAnchor, formatShelfLocator } from "./anchorContext";

function paragraph({
  ordinal = 3,
  sectionOrdinal = 4,
  chapterOrdinal = 2,
  title = "Middlemarch",
} = {}) {
  return {
    ordinal,
    section: {
      id: "work-1::c2::s4",
      ordinal: sectionOrdinal,
      chapter: {
        ordinal: chapterOrdinal,
        work: { id: "work-1", title },
      },
    },
  };
}

describe("describeAnchor", () => {
  it("flattens the paragraph → section → chapter → work chain", () => {
    expect(describeAnchor(paragraph())).toEqual({
      workId: "work-1",
      workTitle: "Middlemarch",
      sectionId: "work-1::c2::s4",
      chapterOrdinal: 2,
      sectionOrdinal: 4,
      paragraphOrdinal: 3,
      locator: "§4 ¶3",
    });
  });

  it("builds the locator from the section's ordinal, not the chapter's", () => {
    expect(
      describeAnchor(
        paragraph({ ordinal: 1, sectionOrdinal: 12, chapterOrdinal: 7 }),
      ).locator,
    ).toBe("§12 ¶1");
  });

  it("ignores extra fields a wider Prisma select carries along", () => {
    const wide = { ...paragraph(), id: "p", text: "Body text.", html: "<p/>" };
    expect(describeAnchor(wide)).not.toHaveProperty("text");
  });
});

describe("formatShelfLocator", () => {
  it("prefixes the locator with the book and chapter", () => {
    expect(formatShelfLocator(describeAnchor(paragraph()))).toBe(
      "Middlemarch · Ch. 2 §4 ¶3",
    );
  });

  it("uses the title verbatim, punctuation and all", () => {
    expect(
      formatShelfLocator(
        describeAnchor(paragraph({ title: "Capital · Vol. 1: A Critique" })),
      ),
    ).toBe("Capital · Vol. 1: A Critique · Ch. 2 §4 ¶3");
  });

  it("still renders with an empty title", () => {
    expect(formatShelfLocator(describeAnchor(paragraph({ title: "" })))).toBe(
      " · Ch. 2 §4 ¶3",
    );
  });
});
