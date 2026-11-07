import { describe, expect, it } from "vitest";
import { formatLocatorRange } from "../locator";
import { buildOnScreenExcerpt } from "./onScreenExcerpt";

function para(
  sectionOrdinal: number,
  ordinal: number,
  globalOrdinal: number,
  text = `p${globalOrdinal}`,
) {
  return { ordinal, globalOrdinal, text, section: { ordinal: sectionOrdinal } };
}

describe("buildOnScreenExcerpt", () => {
  it("returns null when there is no range yet", () => {
    expect(buildOnScreenExcerpt([para(1, 1, 1)], null)).toBeNull();
  });

  it("returns null when no paragraph falls inside the range", () => {
    expect(
      buildOnScreenExcerpt([para(1, 1, 1), para(1, 2, 2)], {
        minGlobalOrdinal: 10,
        maxGlobalOrdinal: 20,
      }),
    ).toBeNull();
  });

  it("sorts by globalOrdinal before joining text with blank lines", () => {
    const excerpt = buildOnScreenExcerpt(
      [para(1, 3, 3, "third"), para(1, 1, 1, "first"), para(1, 2, 2, "second")],
      { minGlobalOrdinal: 1, maxGlobalOrdinal: 3 },
    );
    expect(excerpt?.text).toBe("first\n\nsecond\n\nthird");
  });

  it("filters out paragraphs outside the range, keeping both bounds", () => {
    const excerpt = buildOnScreenExcerpt(
      [para(1, 1, 1), para(1, 2, 2), para(1, 3, 3), para(1, 4, 4)],
      { minGlobalOrdinal: 2, maxGlobalOrdinal: 3 },
    );
    expect(excerpt?.text).toBe("p2\n\np3");
  });

  it("gives a single-paragraph locator for one paragraph", () => {
    const excerpt = buildOnScreenExcerpt([para(4, 3, 30)], {
      minGlobalOrdinal: 30,
      maxGlobalOrdinal: 30,
    });
    expect(excerpt?.locator).toBe(
      formatLocatorRange(
        { sectionLabel: "4", paragraphOrdinal: 3 },
        { sectionLabel: "4", paragraphOrdinal: 3 },
      ),
    );
    expect(excerpt?.locator).toBe("§4 ¶3");
  });

  it("builds a cross-section locator from the first and last paragraphs", () => {
    const excerpt = buildOnScreenExcerpt(
      [para(5, 1, 12), para(4, 9, 10), para(4, 10, 11)],
      { minGlobalOrdinal: 10, maxGlobalOrdinal: 12 },
    );
    expect(excerpt?.locator).toBe(
      formatLocatorRange(
        { sectionLabel: "4", paragraphOrdinal: 9 },
        { sectionLabel: "5", paragraphOrdinal: 1 },
      ),
    );
  });

  it("reports the bounds actually found, not the requested range", () => {
    const excerpt = buildOnScreenExcerpt([para(1, 5, 5), para(1, 7, 7)], {
      minGlobalOrdinal: 1,
      maxGlobalOrdinal: 100,
    });
    expect(excerpt?.minGlobalOrdinal).toBe(5);
    expect(excerpt?.maxGlobalOrdinal).toBe(7);
  });
});
