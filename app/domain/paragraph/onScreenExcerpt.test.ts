import { describe, expect, it } from "vitest";
import { buildOnScreenExcerpt } from "./onScreenExcerpt";

function paragraph(globalOrdinal: number, sectionOrdinal = 1, ordinal = 0) {
  return {
    // Within-section ordinal defaults to the global one — true for a
    // single-section fixture, overridden where a test crosses sections.
    ordinal: ordinal || globalOrdinal,
    globalOrdinal,
    text: `Paragraph ${globalOrdinal}.`,
    section: { ordinal: sectionOrdinal },
  };
}

const FIVE = [1, 2, 3, 4, 5].map((n) => paragraph(n));

describe("buildOnScreenExcerpt", () => {
  it("returns null when there's no range yet", () => {
    expect(buildOnScreenExcerpt(FIVE, null)).toBeNull();
  });

  it("returns null when there are no paragraphs at all", () => {
    expect(
      buildOnScreenExcerpt([], { minGlobalOrdinal: 1, maxGlobalOrdinal: 5 }),
    ).toBeNull();
  });

  it("returns null when no loaded paragraph falls inside the range", () => {
    expect(
      buildOnScreenExcerpt(FIVE, { minGlobalOrdinal: 9, maxGlobalOrdinal: 12 }),
    ).toBeNull();
  });

  it("joins the paragraphs in range with blank lines and spans their locator", () => {
    expect(
      buildOnScreenExcerpt(FIVE, { minGlobalOrdinal: 2, maxGlobalOrdinal: 4 }),
    ).toEqual({
      text: "Paragraph 2.\n\nParagraph 3.\n\nParagraph 4.",
      locator: "§1 ¶2–4",
      minGlobalOrdinal: 2,
      maxGlobalOrdinal: 4,
    });
  });

  it("includes both ends of the range", () => {
    const excerpt = buildOnScreenExcerpt(FIVE, {
      minGlobalOrdinal: 1,
      maxGlobalOrdinal: 5,
    });
    expect(excerpt?.text.split("\n\n")).toHaveLength(5);
  });

  it("collapses to a single-paragraph locator for a one-paragraph range", () => {
    expect(
      buildOnScreenExcerpt(FIVE, { minGlobalOrdinal: 3, maxGlobalOrdinal: 3 }),
    ).toEqual({
      text: "Paragraph 3.",
      locator: "§1 ¶3",
      minGlobalOrdinal: 3,
      maxGlobalOrdinal: 3,
    });
  });

  it("orders by globalOrdinal regardless of the order paragraphs arrive in", () => {
    const shuffled = [FIVE[3], FIVE[1], FIVE[4], FIVE[0], FIVE[2]];
    expect(
      buildOnScreenExcerpt(shuffled, {
        minGlobalOrdinal: 2,
        maxGlobalOrdinal: 4,
      }),
    ).toMatchObject({
      text: "Paragraph 2.\n\nParagraph 3.\n\nParagraph 4.",
      locator: "§1 ¶2–4",
    });
    // Sorting is on a copy — the caller's array is left as it was.
    expect(shuffled.map((p) => p.globalOrdinal)).toEqual([4, 2, 5, 1, 3]);
  });

  // The bounds describe what the excerpt actually contains, not what was
  // asked for: a range wider than the loaded content window reports the
  // narrower span it could fill.
  it("clamps the reported bounds to the paragraphs actually found", () => {
    expect(
      buildOnScreenExcerpt(FIVE, { minGlobalOrdinal: 4, maxGlobalOrdinal: 40 }),
    ).toMatchObject({
      locator: "§1 ¶4–5",
      minGlobalOrdinal: 4,
      maxGlobalOrdinal: 5,
    });
  });

  it("writes a two-section locator when the range crosses a section boundary", () => {
    const acrossSections = [
      paragraph(7, 2, 7),
      paragraph(8, 2, 8),
      paragraph(9, 3, 1),
    ];
    expect(
      buildOnScreenExcerpt(acrossSections, {
        minGlobalOrdinal: 8,
        maxGlobalOrdinal: 9,
      }),
    ).toMatchObject({
      locator: "§2 ¶8 – §3 ¶1",
      minGlobalOrdinal: 8,
      maxGlobalOrdinal: 9,
    });
  });

  it("returns null for an inverted range", () => {
    expect(
      buildOnScreenExcerpt(FIVE, { minGlobalOrdinal: 4, maxGlobalOrdinal: 2 }),
    ).toBeNull();
  });
});
