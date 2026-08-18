import { describe, expect, it } from "vitest";
import {
  computeVisibleOrdinalRange,
  pickCurrentParagraph,
  pickCurrentSectionParagraph,
  type ScrollCandidate,
} from "./scrollPosition";

/** A candidate at `top`, tall enough to still be on screen unless a test
 * says otherwise — most of these only care about `topOffsetPx`. */
function at(
  id: string,
  globalOrdinal: number,
  topOffsetPx: number,
  heightPx = 100,
): ScrollCandidate {
  return {
    id,
    globalOrdinal,
    topOffsetPx,
    bottomOffsetPx: topOffsetPx + heightPx,
  };
}

describe("pickCurrentParagraph", () => {
  it("picks the furthest-into-the-work candidate among those under the threshold", () => {
    const candidates: ScrollCandidate[] = [
      at("p1", 1, -400),
      at("p2", 2, -20),
      at("p3", 3, 200), // still below the fold
    ];
    expect(pickCurrentParagraph(candidates, 40)?.id).toBe("p2");
  });

  it("excludes a candidate sitting exactly at the threshold (half-open, matching HighlightSpan elsewhere)", () => {
    expect(pickCurrentParagraph([at("p1", 1, 40)], 40)).toBeNull();
  });

  it("is null when nothing has crossed the threshold yet", () => {
    const candidates: ScrollCandidate[] = [at("p1", 1, 100), at("p2", 2, 500)];
    expect(pickCurrentParagraph(candidates, 40)).toBeNull();
  });

  it("is null for an empty candidate list", () => {
    expect(pickCurrentParagraph([], 40)).toBeNull();
  });

  it("breaks ties toward document order's later ordinal even if it isn't the one with the smallest top offset", () => {
    // A short paragraph fully scrolled past can sit "above" a taller one
    // that started even earlier — globalOrdinal, not topOffsetPx magnitude,
    // is what decides "furthest into the work".
    const candidates: ScrollCandidate[] = [at("p1", 5, -10), at("p2", 6, -300)];
    expect(pickCurrentParagraph(candidates, 40)?.id).toBe("p2");
  });
});

const VIEWPORT = 834; // the reading column height these offsets are against

describe("pickCurrentSectionParagraph", () => {
  it("picks the topmost paragraph still on screen, not the furthest one already read", () => {
    const candidates: ScrollCandidate[] = [
      at("p1", 1, -400), // scrolled entirely past
      at("p2", 2, -20), // straddling the top edge
      at("p3", 3, 200),
    ];
    expect(pickCurrentSectionParagraph(candidates, VIEWPORT)?.id).toBe("p2");
  });

  it("resolves a section deep link to the section landed on, not the one before it", () => {
    // The regression this rule exists for. Landing on a section puts its
    // divider at the top edge, so the new section's first paragraph starts
    // a divider's height (42px) down — past the 40px read threshold —
    // while the previous section's last paragraph has only just cleared
    // the edge. pickCurrentParagraph picks that stale one; this must not.
    const candidates: ScrollCandidate[] = [
      { id: "prev", globalOrdinal: 731, topOffsetPx: -32, bottomOffsetPx: 0 },
      { id: "landed", globalOrdinal: 732, topOffsetPx: 42, bottomOffsetPx: 74 },
    ];
    expect(pickCurrentParagraph(candidates, 40)?.id).toBe("prev");
    expect(pickCurrentSectionParagraph(candidates, VIEWPORT)?.id).toBe(
      "landed",
    );
  });

  it("ignores a paragraph whose bottom rests exactly on the top edge", () => {
    // Zero height left on screen is no height at all — it belongs to what
    // has been scrolled past, not to what's being looked at.
    const candidates: ScrollCandidate[] = [
      { id: "p1", globalOrdinal: 1, topOffsetPx: -60, bottomOffsetPx: 0 },
      { id: "p2", globalOrdinal: 2, topOffsetPx: 0, bottomOffsetPx: 60 },
    ];
    expect(pickCurrentSectionParagraph(candidates, VIEWPORT)?.id).toBe("p2");
  });

  it("ignores a sub-pixel sliver left by a fractional landing", () => {
    // The exact shape observed in the browser: the deep link puts the
    // divider at 0.3px rather than a clean 0, leaving the previous
    // section's last paragraph with 0.3px on screen. Nobody is reading
    // 0.3px of a paragraph.
    const candidates: ScrollCandidate[] = [
      {
        id: "prev",
        globalOrdinal: 53,
        topOffsetPx: -188.7,
        bottomOffsetPx: 0.3,
      },
      {
        id: "landed",
        globalOrdinal: 54,
        topOffsetPx: 42.95,
        bottomOffsetPx: 74.45,
      },
    ];
    expect(pickCurrentSectionParagraph(candidates, VIEWPORT)?.id).toBe(
      "landed",
    );
  });

  it("still counts a paragraph with a real sliver of a line showing", () => {
    // Well above the rounding allowance — the reader can see this, so it
    // is still what they are looking at.
    const candidates: ScrollCandidate[] = [
      { id: "prev", globalOrdinal: 1, topOffsetPx: -100, bottomOffsetPx: 20 },
      { id: "next", globalOrdinal: 2, topOffsetPx: 20, bottomOffsetPx: 120 },
    ];
    expect(pickCurrentSectionParagraph(candidates, VIEWPORT)?.id).toBe("prev");
  });

  it("moves back up with the reader, unlike the monotonic bookmark", () => {
    const candidates: ScrollCandidate[] = [at("p1", 10, -10), at("p2", 11, 90)];
    expect(pickCurrentSectionParagraph(candidates, VIEWPORT)?.id).toBe("p1");
  });

  it("is null for an empty candidate list", () => {
    expect(pickCurrentSectionParagraph([], VIEWPORT)).toBeNull();
  });

  it("ignores rows mounted far below the viewport, as a deep link's first settle sees", () => {
    // The anchored window mounts around the target while scrollTop is
    // still 0, so every mounted row sits thousands of px below the fold.
    // None of them is what the reader is looking at.
    const candidates: ScrollCandidate[] = [
      at("far1", 730, 227000),
      at("far2", 731, 227300),
    ];
    expect(pickCurrentSectionParagraph(candidates, VIEWPORT)).toBeNull();
  });

  it("is null when every candidate has scrolled entirely above the edge", () => {
    const candidates: ScrollCandidate[] = [
      { id: "p1", globalOrdinal: 1, topOffsetPx: -200, bottomOffsetPx: -100 },
    ];
    expect(pickCurrentSectionParagraph(candidates, VIEWPORT)).toBeNull();
  });
});

describe("computeVisibleOrdinalRange", () => {
  it("is null for an empty candidate list", () => {
    expect(computeVisibleOrdinalRange([])).toBeNull();
  });

  it("is the single candidate's own ordinal, both ends, for a list of one", () => {
    expect(computeVisibleOrdinalRange([at("p1", 7, -100)])).toEqual({
      minGlobalOrdinal: 7,
      maxGlobalOrdinal: 7,
    });
  });

  it("spans the lowest and highest globalOrdinal, regardless of list order", () => {
    const candidates: ScrollCandidate[] = [
      at("p3", 30, 500),
      at("p1", 10, -800),
      at("p2", 20, -300),
    ];
    expect(computeVisibleOrdinalRange(candidates)).toEqual({
      minGlobalOrdinal: 10,
      maxGlobalOrdinal: 30,
    });
  });

  it("includes every candidate, not just ones that have crossed the read threshold", () => {
    // Unlike pickCurrentParagraph, this isn't filtered by topOffsetPx at
    // all — a paragraph still well below the fold is still part of the
    // mounted window marginalia scopes to.
    const candidates: ScrollCandidate[] = [
      at("p1", 1, -900),
      at("p2", 2, 2000), // far below the fold
    ];
    expect(computeVisibleOrdinalRange(candidates)).toEqual({
      minGlobalOrdinal: 1,
      maxGlobalOrdinal: 2,
    });
  });
});
