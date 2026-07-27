import { describe, expect, it } from "vitest";
import { overlapsExisting } from "./highlightOverlap";

describe("overlapsExisting", () => {
  it("is false when there's no existing data", () => {
    expect(overlapsExisting([{ paragraphId: "p1", start: 0, end: 10 }], [])).toBe(false);
  });

  it("is false for spans on different paragraphs, even with identical offsets", () => {
    expect(
      overlapsExisting(
        [{ paragraphId: "p1", start: 0, end: 10 }],
        [{ paragraphId: "p2", start: 0, end: 10 }],
      ),
    ).toBe(false);
  });

  it("is false for spans that merely touch", () => {
    expect(
      overlapsExisting(
        [{ paragraphId: "p1", start: 10, end: 20 }],
        [{ paragraphId: "p1", start: 0, end: 10 }],
      ),
    ).toBe(false);
  });

  it("is true for a partial overlap", () => {
    expect(
      overlapsExisting(
        [{ paragraphId: "p1", start: 5, end: 15 }],
        [{ paragraphId: "p1", start: 0, end: 10 }],
      ),
    ).toBe(true);
  });

  it("is true for an exact duplicate", () => {
    expect(
      overlapsExisting(
        [{ paragraphId: "p1", start: 0, end: 10 }],
        [{ paragraphId: "p1", start: 0, end: 10 }],
      ),
    ).toBe(true);
  });

  it("is true when one range is fully nested inside the other", () => {
    expect(
      overlapsExisting(
        [{ paragraphId: "p1", start: 24, end: 251 }],
        [{ paragraphId: "p1", start: 0, end: 251 }],
      ),
    ).toBe(true);
  });

  it("checks every candidate against every existing span across paragraphs", () => {
    // A spanning highlight touching two paragraphs — only the second
    // collides with something already there.
    expect(
      overlapsExisting(
        [
          { paragraphId: "p1", start: 0, end: 10 },
          { paragraphId: "p2", start: 0, end: 10 },
        ],
        [{ paragraphId: "p2", start: 5, end: 8 }],
      ),
    ).toBe(true);
  });
});
