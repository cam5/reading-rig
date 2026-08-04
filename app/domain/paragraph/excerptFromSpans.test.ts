import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { excerptFromSpans } from "./excerptFromSpans";

function paragraph(text: string) {
  const { document } = parseHTML(`<html><body><p>${text}</p></body></html>`);
  return document.querySelector("p")!;
}

describe("excerptFromSpans", () => {
  it("slices a single-paragraph span", () => {
    const p = paragraph("Hello world.");
    expect(excerptFromSpans([{ element: p, start: 0, end: 5 }])).toBe("Hello");
  });

  it("joins a spanning selection's per-paragraph slices with a space", () => {
    const { document } = parseHTML(`
      <html><body>
        <p id="p1">Hello world.</p>
        <p id="p2">Second paragraph.</p>
      </body></html>
    `);
    const p1 = document.querySelector("#p1")!;
    const p2 = document.querySelector("#p2")!;
    const excerpt = excerptFromSpans([
      { element: p1, start: 6, end: 12 },
      { element: p2, start: 0, end: 6 },
    ]);
    expect(excerpt).toBe("world. Second");
  });

  it("returns an empty string for no spans", () => {
    expect(excerptFromSpans([])).toBe("");
  });
});
