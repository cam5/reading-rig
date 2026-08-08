import { describe, expect, it } from "vitest";
import { buildRigLaunchContext, formatOnScreenExcerpt } from "./buildLaunchContext";

describe("buildRigLaunchContext", () => {
  it("includes the title, author, and excerpt", () => {
    const context = buildRigLaunchContext({ title: "Pride and Prejudice", author: "Jane Austen" }, "It is a truth universally acknowledged...");
    expect(context).toContain('"Pride and Prejudice"');
    expect(context).toContain("by Jane Austen");
    expect(context).toContain("It is a truth universally acknowledged...");
  });

  it("omits the byline when the work has no author", () => {
    const context = buildRigLaunchContext({ title: "Anonymous Work", author: null }, "Some text.");
    expect(context).not.toContain(" by ");
    expect(context).toContain('"Anonymous Work"');
  });

  it("wraps the whole thing in a ⟦context⟧ tag for the transcript to collapse", () => {
    const context = buildRigLaunchContext({ title: "Pride and Prejudice", author: "Jane Austen" }, "It is a truth...");
    expect(context.startsWith("⟦context⟧")).toBe(true);
    expect(context.endsWith("⟦/context⟧")).toBe(true);
  });
});

describe("formatOnScreenExcerpt", () => {
  const paragraphs = [
    { globalOrdinal: 1, text: "First." },
    { globalOrdinal: 2, text: "Second." },
    { globalOrdinal: 3, text: "Third." },
  ];

  it("joins only the paragraphs within range, in ordinal order", () => {
    expect(formatOnScreenExcerpt(paragraphs, { minGlobalOrdinal: 1, maxGlobalOrdinal: 2 })).toBe("First.\n\nSecond.");
  });

  it("returns an empty string when range is null", () => {
    expect(formatOnScreenExcerpt(paragraphs, null)).toBe("");
  });

  it("returns an empty string when nothing falls inside range", () => {
    expect(formatOnScreenExcerpt(paragraphs, { minGlobalOrdinal: 50, maxGlobalOrdinal: 60 })).toBe("");
  });
});
