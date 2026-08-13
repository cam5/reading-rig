import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { resolveContainerSelectionSpans } from "./resolveContainerSelection";

/** A reading column: two paragraphs marked data-paragraph-id, plus sibling
 * content outside it (the shape a triple click can spill into). */
function readingColumn() {
  const { document } = parseHTML(`
    <html><body>
      <div id="outside">Sidebar content, not a paragraph.</div>
      <div id="container">
        <p data-paragraph-id="p1">Hello world.</p>
        <p data-paragraph-id="p2">Second paragraph.</p>
      </div>
    </body></html>
  `);
  return {
    document,
    container: document.querySelector("#container")!,
    outside: document.querySelector("#outside")!,
    p1: document.querySelector('[data-paragraph-id="p1"]')!,
    p2: document.querySelector('[data-paragraph-id="p2"]')!,
  };
}

describe("resolveContainerSelectionSpans", () => {
  it("resolves a selection entirely within one paragraph", () => {
    const { container, p1 } = readingColumn();
    const textNode = p1.firstChild!;
    const spans = resolveContainerSelectionSpans(container, {
      startContainer: textNode,
      startOffset: 0,
      endContainer: textNode,
      endOffset: 5,
    });
    expect(spans).toEqual([{ element: p1, start: 0, end: 5 }]);
  });

  it("resolves a selection spanning two paragraphs, in document order", () => {
    const { container, p1, p2 } = readingColumn();
    const spans = resolveContainerSelectionSpans(container, {
      startContainer: p1.firstChild!,
      startOffset: 6,
      endContainer: p2.firstChild!,
      endOffset: 6,
    });
    expect(spans).toEqual([
      { element: p1, start: 6, end: 12 },
      { element: p2, start: 0, end: 6 },
    ]);
  });

  it("clamps to the last paragraph when the selection's end spills outside the container", () => {
    // The triple-click-past-the-end quirk: startContainer is inside p2,
    // endContainer lands in unrelated sibling content outside container.
    const { container, outside, p2 } = readingColumn();
    const spans = resolveContainerSelectionSpans(container, {
      startContainer: p2.firstChild!,
      startOffset: 0,
      endContainer: outside.firstChild!,
      endOffset: 0,
    });
    expect(spans).toEqual([
      { element: p2, start: 0, end: p2.textContent!.length },
    ]);
  });

  it("clamps to the first paragraph when the selection's start is outside the container", () => {
    const { container, outside, p1 } = readingColumn();
    const spans = resolveContainerSelectionSpans(container, {
      startContainer: outside.firstChild!,
      startOffset: 0,
      endContainer: p1.firstChild!,
      endOffset: 5,
    });
    expect(spans).toEqual([{ element: p1, start: 0, end: 5 }]);
  });

  it("returns null when neither boundary is inside the container", () => {
    const { container, outside } = readingColumn();
    const spans = resolveContainerSelectionSpans(container, {
      startContainer: outside.firstChild!,
      startOffset: 0,
      endContainer: outside.firstChild!,
      endOffset: 5,
    });
    expect(spans).toBeNull();
  });

  it("returns null when the container has no marked paragraphs", () => {
    const { document } = parseHTML(
      `<html><body><div id="c"><p>No marker here.</p></div></body></html>`,
    );
    const container = document.querySelector("#c")!;
    const textNode = container.querySelector("p")!.firstChild!;
    const spans = resolveContainerSelectionSpans(container, {
      startContainer: textNode,
      startOffset: 0,
      endContainer: textNode,
      endOffset: 3,
    });
    expect(spans).toBeNull();
  });

  it("returns null for a collapsed (zero-width) selection", () => {
    const { container, p1 } = readingColumn();
    const textNode = p1.firstChild!;
    const spans = resolveContainerSelectionSpans(container, {
      startContainer: textNode,
      startOffset: 3,
      endContainer: textNode,
      endOffset: 3,
    });
    expect(spans).toBeNull();
  });
});
