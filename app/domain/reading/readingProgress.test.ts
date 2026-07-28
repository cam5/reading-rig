import { describe, expect, it } from "vitest";
import { computeProgressPercent, computeReadingProgress, computeRemainingWords } from "./readingProgress";

describe("computeProgressPercent", () => {
  it("is the bookmark's ordinal over the whole work's paragraph count, rounded", () => {
    expect(computeProgressPercent(200, 50)).toBe(25);
  });

  it("rounds rather than truncates", () => {
    expect(computeProgressPercent(3, 2)).toBe(67); // 66.67% rounds up
  });

  it("is zero for a work with no paragraphs, rather than dividing by zero", () => {
    expect(computeProgressPercent(0, 0)).toBe(0);
  });

  it("is zero before anything has been read", () => {
    expect(computeProgressPercent(100, 0)).toBe(0);
  });
});

describe("computeRemainingWords", () => {
  it("sums only paragraphs strictly past the bookmark", () => {
    const paragraphs = [
      { globalOrdinal: 1, wordCount: 10 },
      { globalOrdinal: 2, wordCount: 20 },
      { globalOrdinal: 3, wordCount: 30 },
    ];
    expect(computeRemainingWords(paragraphs, 1)).toBe(50);
  });

  it("excludes the paragraph exactly at the bookmark, matching isWithinBookmark's own boundary", () => {
    const paragraphs = [{ globalOrdinal: 5, wordCount: 100 }];
    expect(computeRemainingWords(paragraphs, 5)).toBe(0);
  });

  it("is zero once every paragraph is behind the bookmark", () => {
    const paragraphs = [
      { globalOrdinal: 1, wordCount: 10 },
      { globalOrdinal: 2, wordCount: 20 },
    ];
    expect(computeRemainingWords(paragraphs, 100)).toBe(0);
  });
});

describe("computeReadingProgress", () => {
  it("bundles both readouts from the same two inputs, without a second query", () => {
    const paragraphs = [
      { globalOrdinal: 1, wordCount: 200 },
      { globalOrdinal: 2, wordCount: 200 },
      { globalOrdinal: 3, wordCount: 200 },
      { globalOrdinal: 4, wordCount: 200 },
    ];
    expect(computeReadingProgress(paragraphs, 4, 2)).toEqual({
      progressPercent: 50,
      timeLeft: "2 min left",
    });
  });
});
