import { describe, expect, it } from "vitest";
import { formatLocator, formatLocatorRange } from "./locator";

describe("formatLocator", () => {
  it("writes a position the way the design does", () => {
    expect(formatLocator({ sectionLabel: "4", paragraphOrdinal: 3 })).toBe(
      "§4 ¶3",
    );
  });

  it("does not assume section labels are numeric", () => {
    expect(formatLocator({ sectionLabel: "4a", paragraphOrdinal: 1 })).toBe(
      "§4a ¶1",
    );
  });
});

describe("formatLocatorRange", () => {
  it("collapses a paragraph span within one section", () => {
    expect(
      formatLocatorRange(
        { sectionLabel: "4", paragraphOrdinal: 2 },
        { sectionLabel: "4", paragraphOrdinal: 3 },
      ),
    ).toBe("§4 ¶2–3");
  });

  it("collapses a span of one to a bare locator", () => {
    expect(
      formatLocatorRange(
        { sectionLabel: "4", paragraphOrdinal: 3 },
        { sectionLabel: "4", paragraphOrdinal: 3 },
      ),
    ).toBe("§4 ¶3");
  });

  it("spells both ends out when the span crosses a section", () => {
    expect(
      formatLocatorRange(
        { sectionLabel: "4", paragraphOrdinal: 9 },
        { sectionLabel: "5", paragraphOrdinal: 1 },
      ),
    ).toBe("§4 ¶9 – §5 ¶1");
  });

  it("uses an en dash, not a hyphen", () => {
    const span = formatLocatorRange(
      { sectionLabel: "4", paragraphOrdinal: 2 },
      { sectionLabel: "4", paragraphOrdinal: 3 },
    );
    expect(span).toContain("–");
    expect(span).not.toContain("-");
  });
});
