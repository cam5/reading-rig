import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import {
  resolveSelectionOffsets,
  resolveSelectionSpans,
} from "./resolveSelectionOffset";

function paragraphFrom(html: string) {
  const { document } = parseHTML(`<html><body><p>${html}</p></body></html>`);
  return { document, p: document.querySelector("p")! };
}

/** A column of `<p>`s, the shape SelectionHighlighter hands to resolveSelectionSpans. */
function paragraphsFrom(...htmls: string[]) {
  const { document } = parseHTML(
    `<html><body><div>${htmls.map((h) => `<p>${h}</p>`).join("")}</div></body></html>`,
  );
  return { document, ps: Array.from(document.querySelectorAll("p")) };
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

describe("resolveSelectionSpans", () => {
  it("resolves a selection confined to one paragraph the same as resolveSelectionOffsets", () => {
    const { ps } = paragraphsFrom("Hello world.", "Second paragraph.");
    const textNode = ps[0].firstChild!;
    const result = resolveSelectionSpans([ps[0]], {
      startContainer: textNode,
      startOffset: 6,
      endContainer: textNode,
      endOffset: 11,
    });
    expect(result).toEqual([{ element: ps[0], start: 6, end: 11 }]);
  });

  it("resolves a selection spanning two paragraphs: partial-to-partial", () => {
    const { ps } = paragraphsFrom("Hello world.", "Second paragraph here.");
    // "world." in the first paragraph, "Second" in the second.
    const result = resolveSelectionSpans(ps, {
      startContainer: ps[0].firstChild!,
      startOffset: 6,
      endContainer: ps[1].firstChild!,
      endOffset: 6,
    });
    expect(result).toEqual([
      { element: ps[0], start: 6, end: "Hello world.".length },
      { element: ps[1], start: 0, end: 6 },
    ]);
  });

  it("fully covers every paragraph strictly between the first and last", () => {
    const { ps } = paragraphsFrom(
      "First one.",
      "Middle one.",
      "Last one here.",
    );
    const result = resolveSelectionSpans(ps, {
      startContainer: ps[0].firstChild!,
      startOffset: 6, // "one." in the first paragraph
      endContainer: ps[2].firstChild!,
      endOffset: 4, // "Last" in the last paragraph
    });
    expect(result).toEqual([
      { element: ps[0], start: 6, end: "First one.".length },
      { element: ps[1], start: 0, end: "Middle one.".length },
      { element: ps[2], start: 0, end: 4 },
    ]);
  });

  it("handles a backward drag (range.startContainer in the visually later paragraph)", () => {
    const { ps } = paragraphsFrom("Hello world.", "Second paragraph here.");
    // Same selection as the partial-to-partial case above, but the user
    // dragged from the second paragraph back up to the first — the Range's
    // own start/end still follow document order, so this exercises the
    // same boundary-to-paragraph matching as a forward drag would. The
    // meaningful backward case is at the DOM level (anchor after focus),
    // which SelectionHighlighter normalises before calling in; here we
    // confirm the resolver doesn't assume `paragraphElements[0]` holds
    // `range.startContainer`.
    const result = resolveSelectionSpans(ps, {
      startContainer: ps[1].firstChild!,
      startOffset: 6,
      endContainer: ps[0].firstChild!,
      endOffset: 6,
    });
    expect(result).toEqual([
      { element: ps[0], start: 6, end: "Hello world.".length },
      { element: ps[1], start: 0, end: 6 },
    ]);
  });

  it("returns null when neither boundary resolves against the given paragraphs", () => {
    const { ps } = paragraphsFrom("Hello world.", "Second paragraph.");
    const { p: outsider } = paragraphFrom("Unrelated.");
    const result = resolveSelectionSpans(ps, {
      startContainer: outsider.firstChild!,
      startOffset: 0,
      endContainer: outsider.firstChild!,
      endOffset: 5,
    });
    expect(result).toBeNull();
  });

  it("returns null for an empty paragraph list", () => {
    const { ps } = paragraphsFrom("Hello world.");
    const result = resolveSelectionSpans([], {
      startContainer: ps[0].firstChild!,
      startOffset: 0,
      endContainer: ps[0].firstChild!,
      endOffset: 5,
    });
    expect(result).toBeNull();
  });

  it("trims a triple-click's phantom reach into the next paragraph", () => {
    const { ps } = paragraphsFrom("Hello world.", "Second paragraph here.");
    // Mac triple-click artifact: endContainer lands on the *next*
    // paragraph's element at offset 0, even though nothing there was
    // actually selected — should resolve as if only ps[0] was given.
    const result = resolveSelectionSpans([ps[0], ps[1]], {
      startContainer: ps[0].firstChild!,
      startOffset: 0,
      endContainer: ps[1],
      endOffset: 0,
    });
    expect(result).toEqual([
      { element: ps[0], start: 0, end: "Hello world.".length },
    ]);
  });

  it("trims a phantom empty span at the start of a spanning selection", () => {
    const { ps } = paragraphsFrom(
      "First one.",
      "Middle one.",
      "Last one here.",
    );
    // A drag starting exactly at the end of ps[0] — nothing selected there.
    const result = resolveSelectionSpans(ps, {
      startContainer: ps[0].firstChild!,
      startOffset: "First one.".length,
      endContainer: ps[2].firstChild!,
      endOffset: 4,
    });
    expect(result).toEqual([
      { element: ps[1], start: 0, end: "Middle one.".length },
      { element: ps[2], start: 0, end: 4 },
    ]);
  });
});
