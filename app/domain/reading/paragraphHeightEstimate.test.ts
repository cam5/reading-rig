import { describe, expect, it } from "vitest";
import { estimateParagraphHeightPx } from "./paragraphHeightEstimate";

describe("estimateParagraphHeightPx", () => {
  it("estimates a short, single-line paragraph near one line's height plus its margin", () => {
    const short = "It was the best of times, it was the worst of times.";
    expect(estimateParagraphHeightPx(short)).toBe(53.5);
  });

  it("scales up for a long, many-line paragraph instead of using one flat guess", () => {
    const long = `${"word ".repeat(100).trim()}.`;
    expect(estimateParagraphHeightPx(long)).toBe(242.5);
  });

  it("still returns a defined, one-line-minimum height for an empty paragraph", () => {
    expect(estimateParagraphHeightPx("")).toBe(53.5);
  });

  it("grows monotonically with text length", () => {
    const shortHeight = estimateParagraphHeightPx("A short one.");
    const longHeight = estimateParagraphHeightPx("A much longer paragraph. ".repeat(20));
    expect(longHeight).toBeGreaterThan(shortHeight);
  });
});
