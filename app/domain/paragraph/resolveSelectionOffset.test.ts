import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { resolveSelectionOffsets } from "./resolveSelectionOffset";

function paragraphFrom(html: string) {
  const { document } = parseHTML(`<html><body><p>${html}</p></body></html>`);
  return { document, p: document.querySelector("p")! };
}

describe("resolveSelectionOffsets", () => {
  it("resolves a selection entirely within one text node", () => {
    const { p } = paragraphFrom("Hello world.");
    const textNode = p.firstChild!;
    // "world" is offsets 6-11 in "Hello world."
    const result = resolveSelectionOffsets(p, {
      startContainer: textNode,
      startOffset: 6,
      endContainer: textNode,
      endOffset: 11,
    });
    expect(result).toEqual({ start: 6, end: 11 });
  });

  it("resolves a selection that starts inside an <em> and ends after it", () => {
    const { p } = paragraphFrom("The <em>form of wood</em> is altered.");
    const em = p.querySelector("em")!;
    const emText = em.firstChild!; // "form of wood"
    const afterText = em.nextSibling!; // " is altered."
    // Select "wood is" — starts at offset 8 within emText ("form of "|"wood"),
    // ends at offset 3 within afterText (" is"|" altered.").
    const result = resolveSelectionOffsets(p, {
      startContainer: emText,
      startOffset: 8,
      endContainer: afterText,
      endOffset: 3,
    });
    expect(result).toEqual({ start: 12, end: 19 });
    expect(p.textContent!.slice(result!.start, result!.end)).toBe("wood is");
  });

  it("resolves a boundary point that lands on an element, not a text node", () => {
    const { p } = paragraphFrom("Hello <em>world</em>.");
    // Selecting the whole paragraph: start at child index 0 of <p>, end at
    // child index 3 (past the last child) — the browser does this when a
    // selection edge sits exactly on an element boundary.
    const result = resolveSelectionOffsets(p, {
      startContainer: p,
      startOffset: 0,
      endContainer: p,
      endOffset: p.childNodes.length,
    });
    expect(result).toEqual({ start: 0, end: p.textContent!.length });
  });

  it("returns null for a collapsed selection", () => {
    const { p } = paragraphFrom("Hello world.");
    const textNode = p.firstChild!;
    const result = resolveSelectionOffsets(p, {
      startContainer: textNode,
      startOffset: 6,
      endContainer: textNode,
      endOffset: 6,
    });
    expect(result).toBeNull();
  });

  it("resolves the ticket's own acceptance selection within §4 ¶3", () => {
    const text =
      "It is as clear as noon-day, that man, by his industry, changes the " +
      "forms of the materials furnished by Nature, in such a way as to " +
      "make them useful to him. The form of wood, for instance, is " +
      "altered, by making a table out of it. Yet, for all that, the " +
      "table continues to be that common, every-day thing, wood.";
    const { p } = paragraphFrom(text);
    const textNode = p.firstChild!;
    const start = text.indexOf("The form of wood");
    const end = text.length; // "...every-day thing, wood." — runs to the end
    const result = resolveSelectionOffsets(p, {
      startContainer: textNode,
      startOffset: start,
      endContainer: textNode,
      endOffset: end,
    });
    expect(result).toEqual({ start, end });
    expect(text.slice(result!.start, result!.end)).toBe(
      "The form of wood, for instance, is altered, by making a table out " +
        "of it. Yet, for all that, the table continues to be that common, " +
        "every-day thing, wood.",
    );
  });
});
