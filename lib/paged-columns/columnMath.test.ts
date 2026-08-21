import { describe, expect, it } from "vitest";
import {
  columnIndexForOffset,
  estimateMountWindow,
  growMountWindow,
} from "./columnMath";

describe("estimateMountWindow", () => {
  it("is empty for an empty list", () => {
    expect(estimateMountWindow([], 0, 700, 2)).toEqual({
      startIndex: 0,
      endIndex: 0,
    });
  });

  it("mounts just the anchor when radius is 0", () => {
    const sizes = Array(10).fill(100);
    expect(estimateMountWindow(sizes, 5, 700, 0)).toEqual({
      startIndex: 5,
      endIndex: 6,
    });
  });

  it("extends outward by radiusPages worth of guessed budget on each side", () => {
    // 700px pages, radius 1 -> 700px of budget each direction. Items are
    // 100px each, so 7 items' worth extends the window each way.
    const sizes = Array(30).fill(100);
    const win = estimateMountWindow(sizes, 15, 700, 1);
    expect(win.startIndex).toBe(8); // 15 - 7
    expect(win.endIndex).toBe(23); // 15 + 1 + 7
  });

  it("clamps to the list's own bounds rather than going negative or past the end", () => {
    const sizes = Array(5).fill(100);
    const win = estimateMountWindow(sizes, 0, 700, 5);
    expect(win.startIndex).toBe(0);
    expect(win.endIndex).toBe(5);
  });

  it("clamps an out-of-range anchor into the list before walking outward", () => {
    const sizes = Array(5).fill(100);
    expect(estimateMountWindow(sizes, 99, 700, 0)).toEqual({
      startIndex: 4,
      endIndex: 5,
    });
  });

  it("treats a zero-size item as pageSizePx-tall so it still counts toward the budget", () => {
    const sizes = [0, 0, 0, 0, 0];
    const win = estimateMountWindow(sizes, 2, 100, 1);
    // Each item stands in at 100px (pageSizePx) since its own estimate is 0
    // — one item's worth of budget each direction.
    expect(win.startIndex).toBe(1);
    expect(win.endIndex).toBe(4);
  });
});

describe("growMountWindow", () => {
  it("extends only the forward edge for direction 'forward'", () => {
    const sizes = Array(30).fill(100);
    const win = growMountWindow(
      sizes,
      { startIndex: 10, endIndex: 15 },
      "forward",
      300,
    );
    expect(win.startIndex).toBe(10);
    expect(win.endIndex).toBe(18); // 3 more 100px items to cover 300px
  });

  it("extends only the backward edge for direction 'backward'", () => {
    const sizes = Array(30).fill(100);
    const win = growMountWindow(
      sizes,
      { startIndex: 10, endIndex: 15 },
      "backward",
      300,
    );
    expect(win.startIndex).toBe(7);
    expect(win.endIndex).toBe(15);
  });

  it("clamps at the list's own edges", () => {
    const sizes = Array(5).fill(100);
    expect(
      growMountWindow(sizes, { startIndex: 0, endIndex: 5 }, "forward", 1000),
    ).toEqual({
      startIndex: 0,
      endIndex: 5,
    });
    expect(
      growMountWindow(sizes, { startIndex: 0, endIndex: 5 }, "backward", 1000),
    ).toEqual({
      startIndex: 0,
      endIndex: 5,
    });
  });
});

describe("columnIndexForOffset", () => {
  it("rounds to the nearest column", () => {
    expect(columnIndexForOffset(0, 660)).toBe(0);
    expect(columnIndexForOffset(660, 660)).toBe(1);
    expect(columnIndexForOffset(1320, 660)).toBe(2);
  });

  it("is unbiased about sub-pixel drift either side of a boundary", () => {
    expect(columnIndexForOffset(659.6, 660)).toBe(1);
    expect(columnIndexForOffset(660.4, 660)).toBe(1);
  });

  it("degenerates to column 0 for a non-positive step", () => {
    expect(columnIndexForOffset(500, 0)).toBe(0);
  });
});
