import { describe, expect, it } from "vitest";
import { computeParagraphId } from "./paragraphId";

describe("computeParagraphId", () => {
  it("is deterministic — same inputs, same id", () => {
    const a = computeParagraphId("karl-marx/capital-volume-i", 3, "4/1/3");
    const b = computeParagraphId("karl-marx/capital-volume-i", 3, "4/1/3");
    expect(a).toBe(b);
  });

  it("differs when the element path differs, holding work and spine fixed", () => {
    const p3 = computeParagraphId("karl-marx/capital-volume-i", 3, "4/1/3");
    const p4 = computeParagraphId("karl-marx/capital-volume-i", 3, "4/1/4");
    expect(p3).not.toBe(p4);
  });

  it("differs across works, holding spine index and path fixed", () => {
    const a = computeParagraphId("karl-marx/capital-volume-i", 3, "4/1/3");
    const b = computeParagraphId("jane-austen/pride-and-prejudice", 3, "4/1/3");
    expect(a).not.toBe(b);
  });

  it("does not depend on paragraph text — only on structural position", () => {
    // The whole point of content-addressing by position rather than text:
    // fixing a typo in the source must not orphan the paragraph's id. This
    // test just documents that the function's signature has no text
    // parameter at all — there's nothing to accidentally thread through.
    expect(computeParagraphId.length).toBe(3);
  });
});
