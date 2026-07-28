import { describe, expect, it } from "vitest";
import { pickCurrentParagraph, type ScrollCandidate } from "./scrollPosition";

describe("pickCurrentParagraph", () => {
  it("picks the furthest-into-the-work candidate among those under the threshold", () => {
    const candidates: ScrollCandidate[] = [
      { id: "p1", globalOrdinal: 1, topOffsetPx: -400 },
      { id: "p2", globalOrdinal: 2, topOffsetPx: -20 },
      { id: "p3", globalOrdinal: 3, topOffsetPx: 200 }, // still below the fold
    ];
    expect(pickCurrentParagraph(candidates, 40)).toEqual({ id: "p2", globalOrdinal: 2, topOffsetPx: -20 });
  });

  it("excludes a candidate sitting exactly at the threshold (half-open, matching HighlightSpan elsewhere)", () => {
    const candidates: ScrollCandidate[] = [{ id: "p1", globalOrdinal: 1, topOffsetPx: 40 }];
    expect(pickCurrentParagraph(candidates, 40)).toBeNull();
  });

  it("is null when nothing has crossed the threshold yet", () => {
    const candidates: ScrollCandidate[] = [
      { id: "p1", globalOrdinal: 1, topOffsetPx: 100 },
      { id: "p2", globalOrdinal: 2, topOffsetPx: 500 },
    ];
    expect(pickCurrentParagraph(candidates, 40)).toBeNull();
  });

  it("is null for an empty candidate list", () => {
    expect(pickCurrentParagraph([], 40)).toBeNull();
  });

  it("breaks ties toward document order's later ordinal even if it isn't the one with the smallest top offset", () => {
    // A short paragraph fully scrolled past can sit "above" a taller one
    // that started even earlier — globalOrdinal, not topOffsetPx magnitude,
    // is what decides "furthest into the work".
    const candidates: ScrollCandidate[] = [
      { id: "p1", globalOrdinal: 5, topOffsetPx: -10 },
      { id: "p2", globalOrdinal: 6, topOffsetPx: -300 },
    ];
    expect(pickCurrentParagraph(candidates, 40)?.id).toBe("p2");
  });
});
