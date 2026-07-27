import { describe, expect, it } from "vitest";
import { computeVirtualWindow } from "./virtualWindow";

describe("computeVirtualWindow", () => {
  it("is empty for an empty work", () => {
    expect(computeVirtualWindow([], 0, 800, 0)).toEqual({
      startIndex: 0,
      endIndex: 0,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    });
  });

  it("mounts everything when nothing's been measured yet (all-zero heights)", () => {
    // The state before any ResizeObserver callback has fired — heights
    // default to 0, and there's no meaningful window to carve out of zero
    // total height.
    expect(computeVirtualWindow([0, 0, 0, 0, 0], 0, 800, 0)).toEqual({
      startIndex: 0,
      endIndex: 5,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    });
  });

  it("mounts just the viewport's paragraphs at the very top, no overscan", () => {
    // 10 paragraphs, each 100px, an 800px viewport at scrollTop 0 exactly
    // covers paragraphs 0-7 (indices 0..7 occupy [0, 800)).
    const heights = Array(10).fill(100);
    const win = computeVirtualWindow(heights, 0, 800, 0);
    expect(win).toEqual({ startIndex: 0, endIndex: 8, topSpacerHeight: 0, bottomSpacerHeight: 200 });
  });

  it("slides the window forward as scrollTop advances", () => {
    const heights = Array(20).fill(100);
    // scrollTop 500: viewport covers [500, 1300) -> paragraphs 5..12.
    const win = computeVirtualWindow(heights, 500, 800, 0);
    expect(win.startIndex).toBe(5);
    expect(win.endIndex).toBe(13);
    expect(win.topSpacerHeight).toBe(500);
    expect(win.bottomSpacerHeight).toBe(2000 - 1300);
  });

  it("extends the range by overscanPx on both sides", () => {
    const heights = Array(20).fill(100);
    // Same scroll position as above, but with 250px of overscan: viewport
    // effectively covers [250, 1550) -> paragraphs 2..15.
    const win = computeVirtualWindow(heights, 500, 800, 250);
    expect(win.startIndex).toBe(2);
    expect(win.endIndex).toBe(16);
  });

  it("clamps the top of the window at the work's start — no negative spacer", () => {
    const heights = Array(10).fill(100);
    const win = computeVirtualWindow(heights, 0, 800, 500);
    expect(win.startIndex).toBe(0);
    expect(win.topSpacerHeight).toBe(0);
  });

  it("clamps the bottom of the window at the work's end, scrolled all the way down", () => {
    const heights = Array(10).fill(100); // total 1000px
    const win = computeVirtualWindow(heights, 200, 800, 500); // scrolled to the max scrollTop
    expect(win.endIndex).toBe(10);
    expect(win.bottomSpacerHeight).toBe(0);
  });

  it("handles variable paragraph heights via cumulative offsets, not a fixed stride", () => {
    // Offsets: [0, 10, 30, 60, 100] — paragraph 2 spans [30, 60).
    const heights = [10, 20, 30, 40];
    const win = computeVirtualWindow(heights, 45, 10, 0); // viewport [45, 55), inside paragraph 2 only
    expect(win.startIndex).toBe(2);
    expect(win.endIndex).toBe(3);
    expect(win.topSpacerHeight).toBe(30);
    expect(win.bottomSpacerHeight).toBe(40);
  });

  it("mounts a single paragraph work in full", () => {
    const win = computeVirtualWindow([500], 0, 800, 0);
    expect(win).toEqual({ startIndex: 0, endIndex: 1, topSpacerHeight: 0, bottomSpacerHeight: 0 });
  });
});
