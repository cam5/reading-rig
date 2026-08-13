import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEpub } from "../epub/parseEpub";
import { bookmarkWhereClause, isWithinBookmark } from "./bookmark";

const fixturePath = fileURLToPath(
  new URL("../epub/__fixtures__/capital-volume-i.epub", import.meta.url),
);

function allParagraphs() {
  const work = parseEpub(readFileSync(fixturePath));
  return work.chapters.flatMap((c) => c.sections.flatMap((s) => s.paragraphs));
}

describe("isWithinBookmark", () => {
  it("includes the paragraph exactly at the bookmark", () => {
    expect(isWithinBookmark(5, 5)).toBe(true);
  });

  it("excludes anything past the bookmark", () => {
    expect(isWithinBookmark(6, 5)).toBe(false);
  });

  it("the ticket's own scenario: a position set mid-§4 lets nothing past it through", () => {
    const paragraphs = allParagraphs();
    const midSection4 = paragraphs.find(
      (p) => p.text.startsWith("So far as it is a value in use"), // §4 ¶2
    )!;
    const bookmark = midSection4.globalOrdinal;

    const visible = paragraphs.filter((p) =>
      isWithinBookmark(p.globalOrdinal, bookmark),
    );
    const hidden = paragraphs.filter(
      (p) => !isWithinBookmark(p.globalOrdinal, bookmark),
    );

    // Nothing visible is past the bookmark...
    expect(visible.every((p) => p.globalOrdinal <= bookmark)).toBe(true);
    // ...and what's hidden actually is past it — §4 ¶3 and ¶4 specifically,
    // including the exact passage #8's ticket anchors on.
    expect(
      hidden.some((p) => p.text.startsWith("It is as clear as noon-day")),
    ).toBe(true);
    expect(hidden.every((p) => p.globalOrdinal > bookmark)).toBe(true);
  });
});

describe("bookmarkWhereClause", () => {
  it("builds the Prisma filter matching isWithinBookmark's own boundary", () => {
    const clause = bookmarkWhereClause(6);
    expect(clause).toEqual({ globalOrdinal: { lte: 6 } });
  });
});
