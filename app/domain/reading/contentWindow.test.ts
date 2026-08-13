import { describe, expect, it } from "vitest";
import {
  contentFetchTargets,
  extendContentWindow,
  selectInitialContentWindow,
  type StructuralParagraph,
} from "./contentWindow";

/** 1000 paragraphs, 10 words each (80 bytes, at the module's 8B/word
 * estimate) — big enough that any budget below 80,000 bytes truncates
 * well before either edge, and small enough for these tests to reason
 * about by hand. */
function evenWork(
  count: number,
  wordsPerParagraph = 10,
): StructuralParagraph[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    globalOrdinal: i + 1,
    wordCount: wordsPerParagraph,
  }));
}

describe("selectInitialContentWindow", () => {
  it("returns null for an empty work", () => {
    expect(selectInitialContentWindow([], 1)).toBeNull();
  });

  it("returns the whole work when it fits entirely under budget — windowing is a no-op", () => {
    const paragraphs = evenWork(20); // 20 * 80B = 1600B, far under any real budget
    expect(selectInitialContentWindow(paragraphs, 1, 10_000)).toEqual({
      minGlobalOrdinal: 1,
      maxGlobalOrdinal: 20,
    });
  });

  it("expands purely forward when anchored at the very start (no backward room)", () => {
    const paragraphs = evenWork(1000);
    // Budget for exactly 10 paragraphs (10 * 80B = 800B).
    const window = selectInitialContentWindow(paragraphs, 1, 800);
    expect(window!.minGlobalOrdinal).toBe(1);
    expect(window!.maxGlobalOrdinal).toBeGreaterThan(1);
    expect(window!.maxGlobalOrdinal).toBeLessThan(1000);
  });

  it("expands purely backward when anchored at the very end (no forward room)", () => {
    const paragraphs = evenWork(1000);
    const window = selectInitialContentWindow(paragraphs, 1000, 800);
    expect(window!.maxGlobalOrdinal).toBe(1000);
    expect(window!.minGlobalOrdinal).toBeGreaterThan(1);
  });

  it("is forward-biased when anchored mid-work with room on both sides", () => {
    const paragraphs = evenWork(1000);
    const window = selectInitialContentWindow(paragraphs, 500, 800);
    const before = 500 - window!.minGlobalOrdinal;
    const after = window!.maxGlobalOrdinal - 500;
    expect(after).toBeGreaterThan(before);
  });

  it("always includes the anchor paragraph itself, even under a budget smaller than one paragraph", () => {
    const paragraphs = evenWork(1000, 1000); // one huge paragraph, 8000B each
    const window = selectInitialContentWindow(paragraphs, 500, 1);
    expect(window).toEqual({ minGlobalOrdinal: 500, maxGlobalOrdinal: 500 });
  });
});

describe("extendContentWindow", () => {
  const paragraphs = evenWork(1000);

  it("grows forward from the current range's max edge", () => {
    const current = { minGlobalOrdinal: 1, maxGlobalOrdinal: 50 };
    const next = extendContentWindow(paragraphs, current, "forward", 800);
    expect(next!.minGlobalOrdinal).toBe(51);
    expect(next!.maxGlobalOrdinal).toBeGreaterThan(51);
  });

  it("grows backward from the current range's min edge", () => {
    const current = { minGlobalOrdinal: 500, maxGlobalOrdinal: 550 };
    const next = extendContentWindow(paragraphs, current, "backward", 800);
    expect(next!.maxGlobalOrdinal).toBe(499);
    expect(next!.minGlobalOrdinal).toBeLessThan(499);
  });

  it("returns null extending forward past the work's last paragraph", () => {
    const current = { minGlobalOrdinal: 950, maxGlobalOrdinal: 1000 };
    expect(extendContentWindow(paragraphs, current, "forward", 800)).toBeNull();
  });

  it("returns null extending backward past the work's first paragraph", () => {
    const current = { minGlobalOrdinal: 1, maxGlobalOrdinal: 50 };
    expect(
      extendContentWindow(paragraphs, current, "backward", 800),
    ).toBeNull();
  });

  it("clamps to the work's edge rather than overshooting", () => {
    const current = { minGlobalOrdinal: 1, maxGlobalOrdinal: 990 };
    const next = extendContentWindow(paragraphs, current, "forward", 100_000);
    expect(next).toEqual({ minGlobalOrdinal: 991, maxGlobalOrdinal: 1000 });
  });
});

describe("contentFetchTargets", () => {
  const workBounds = { minGlobalOrdinal: 1, maxGlobalOrdinal: 1000 };

  it("fires neither direction before anything is mounted", () => {
    expect(
      contentFetchTargets(
        null,
        { minGlobalOrdinal: 1, maxGlobalOrdinal: 100 },
        workBounds,
      ),
    ).toEqual({
      needForward: false,
      needBackward: false,
    });
  });

  it("does not fire when the mounted window sits well inside the fetched range", () => {
    const mounted = { minGlobalOrdinal: 400, maxGlobalOrdinal: 420 };
    const fetched = { minGlobalOrdinal: 1, maxGlobalOrdinal: 1000 };
    expect(contentFetchTargets(mounted, fetched, workBounds, 40)).toEqual({
      needForward: false,
      needBackward: false,
    });
  });

  it("fires forward once the mounted window comes within the lead distance of the fetched max", () => {
    const mounted = { minGlobalOrdinal: 200, maxGlobalOrdinal: 465 };
    const fetched = { minGlobalOrdinal: 1, maxGlobalOrdinal: 500 };
    expect(contentFetchTargets(mounted, fetched, workBounds, 40)).toEqual({
      needForward: true,
      needBackward: false,
    });
  });

  it("fires backward once the mounted window comes within the lead distance of the fetched min", () => {
    const mounted = { minGlobalOrdinal: 105, maxGlobalOrdinal: 300 };
    const fetched = { minGlobalOrdinal: 100, maxGlobalOrdinal: 1000 };
    expect(contentFetchTargets(mounted, fetched, workBounds, 40)).toEqual({
      needForward: false,
      needBackward: true,
    });
  });

  it("never fires past the work's own bounds even if the mounted window is close", () => {
    const mounted = { minGlobalOrdinal: 1, maxGlobalOrdinal: 990 };
    const fetched = { minGlobalOrdinal: 1, maxGlobalOrdinal: 1000 }; // already reaches the work's end
    expect(contentFetchTargets(mounted, fetched, workBounds, 40)).toEqual({
      needForward: false,
      needBackward: false,
    });
  });
});
