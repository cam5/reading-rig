import { describe, expect, it } from "vitest";
import { bucketEntriesByWhen, provenanceCounts, splitAroundExcerpt } from "./commonplace";

describe("bucketEntriesByWhen", () => {
  // A Wednesday, so "this week" runs back to Monday of the same week.
  const now = new Date(2026, 6, 22, 12, 0, 0);

  it("buckets everything since Monday as This week, current", () => {
    const buckets = bucketEntriesByWhen(
      [{ createdAt: new Date(2026, 6, 20) }, { createdAt: new Date(2026, 6, 22) }],
      now,
    );
    expect(buckets).toEqual([{ label: "This week", count: 2, current: true }]);
  });

  it("groups everything before this week by calendar month, most recent first", () => {
    const buckets = bucketEntriesByWhen(
      [
        { createdAt: new Date(2026, 5, 1) }, // June
        { createdAt: new Date(2026, 5, 15) }, // June
        { createdAt: new Date(2026, 4, 3) }, // May
      ],
      now,
    );
    expect(buckets).toEqual([
      { label: "June", count: 2, current: false },
      { label: "May", count: 1, current: false },
    ]);
  });

  it("appends the year once a month bucket crosses out of now's year", () => {
    const buckets = bucketEntriesByWhen([{ createdAt: new Date(2025, 11, 1) }], now);
    expect(buckets).toEqual([{ label: "December 2025", count: 1, current: false }]);
  });

  it("omits This week entirely when nothing falls in it", () => {
    const buckets = bucketEntriesByWhen([{ createdAt: new Date(2026, 5, 1) }], now);
    expect(buckets.some((b) => b.label === "This week")).toBe(false);
  });

  it("returns nothing for an empty shelf", () => {
    expect(bucketEntriesByWhen([], now)).toEqual([]);
  });
});

describe("provenanceCounts", () => {
  it("tallies hand and rig separately", () => {
    expect(
      provenanceCounts([{ origin: "hand" }, { origin: "rig" }, { origin: "hand" }]),
    ).toEqual({ hand: 2, rig: 1 });
  });

  it("is all zero for an empty shelf", () => {
    expect(provenanceCounts([])).toEqual({ hand: 0, rig: 0 });
  });
});

describe("splitAroundExcerpt", () => {
  const text =
    "It is as clear as noon-day, that man, by his industry, changes the forms of the materials furnished by Nature, in such a way as to make them useful to him. The form of wood, for instance, is altered, by making a table out of it. Yet, for all that, the table continues to be that common, every-day thing, wood.";

  it("splits the paragraph into what's before, the excerpt, and what's after", () => {
    const excerpt = "table continues to be that common, every-day thing, wood";
    const result = splitAroundExcerpt(text, excerpt);
    expect(result.match).toBe(excerpt);
    expect(result.before + result.match + result.after).toBe(text);
    expect(result.after).toBe(".");
  });

  it("falls back to the whole paragraph as the match when there's no excerpt", () => {
    expect(splitAroundExcerpt(text, undefined)).toEqual({ before: "", match: text, after: "" });
  });

  it("falls back to the whole paragraph when the excerpt isn't found in it", () => {
    expect(splitAroundExcerpt(text, "a sentence from a different paragraph entirely")).toEqual({
      before: "",
      match: text,
      after: "",
    });
  });
});
