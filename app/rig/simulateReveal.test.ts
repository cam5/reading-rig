import { describe, expect, it } from "vitest";
import { wordBoundaryOffsets } from "./simulateReveal";

/** Turns cumulative offsets back into the per-word chunk each one added —
 * easier to read in test expectations than the cumulative prefixes
 * `RigMessage` actually consumes. */
function chunksFrom(text: string, offsets: number[]): string[] {
  return offsets.map((end, i) => text.slice(i === 0 ? 0 : offsets[i - 1], end));
}

describe("wordBoundaryOffsets", () => {
  it("returns one offset per word, each ending after that word's trailing whitespace", () => {
    const text = "Hello world.\nA third word";
    const offsets = wordBoundaryOffsets(text);
    expect(chunksFrom(text, offsets)).toEqual([
      "Hello ",
      "world.\n",
      "A ",
      "third ",
      "word",
    ]);
  });

  it("offsets are cumulative prefixes of the original text, ending on a word boundary", () => {
    const text = "Hello world.\nA third word";
    const offsets = wordBoundaryOffsets(text);
    expect(offsets.map((end) => text.slice(0, end))).toEqual([
      "Hello ",
      "Hello world.\n",
      "Hello world.\nA ",
      "Hello world.\nA third ",
      text,
    ]);
    expect(offsets.at(-1)).toBe(text.length);
  });

  it("returns an empty array for empty text", () => {
    expect(wordBoundaryOffsets("")).toEqual([]);
  });

  it("collapses a run of internal whitespace into the previous word's trailing offset, not its own entry", () => {
    const text = "one   two";
    const offsets = wordBoundaryOffsets(text);
    expect(chunksFrom(text, offsets)).toEqual(["one   ", "two"]);
  });
});
