import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import {
  MAX_HIGHLIGHT_STACK_DEPTH,
  mergeHighlightsIntoHtml,
} from "./mergeHighlights";

function textContentOf(html: string): string {
  const { document } = parseHTML(`<div>${html}</div>`);
  return document.querySelector("div")!.textContent ?? "";
}

describe("mergeHighlightsIntoHtml", () => {
  it("passes html through unchanged when there are no highlights", () => {
    const paragraph = { html: "Hello <em>world</em>.", text: "Hello world." };
    expect(mergeHighlightsIntoHtml(paragraph, [])).toBe(paragraph.html);
  });

  it("wraps a range entirely within plain text, tagged with data-highlight-id", () => {
    const paragraph = { html: "Hello world.", text: "Hello world." };
    // "world" is offsets 6-11
    const html = mergeHighlightsIntoHtml(paragraph, [
      { id: "h1", start: 6, end: 11, className: "hl", order: 1 },
    ]);
    expect(html).toBe(
      'Hello <mark data-highlight-id="h1" class="hl">world</mark>.',
    );
  });

  it("the ticket's own fiddly part: a highlight that starts inside an existing <em> and ends after it", () => {
    // "The form of wood is altered" (em covers "form of wood")
    const text = "The form of wood is altered.";
    const html = "The <em>form of wood</em> is altered.";
    // Highlight "wood is" — starts inside the </em> run, ends outside it.
    const start = text.indexOf("wood is");
    const end = start + "wood is".length;
    const merged = mergeHighlightsIntoHtml({ html, text }, [
      { id: "h1", start, end, className: "hl", order: 1 },
    ]);
    // "wood" stays wrapped in <em> (it was already), "is" is plain — both
    // inside the mark; "form of " stays em'd and unhighlighted.
    expect(merged).toBe(
      'The <em>form of </em><mark data-highlight-id="h1" class="hl"><em>wood</em> is</mark> altered.',
    );
  });

  it("wraps a range that exactly matches an existing tag's bounds", () => {
    const paragraph = { html: "Hello <em>world</em>.", text: "Hello world." };
    const start = paragraph.text.indexOf("world");
    const end = start + "world".length;
    const html = mergeHighlightsIntoHtml(paragraph, [
      { id: "h1", start, end, className: "hl", order: 1 },
    ]);
    expect(html).toBe(
      'Hello <mark data-highlight-id="h1" class="hl"><em>world</em></mark>.',
    );
  });

  it("renders multiple non-overlapping highlights in the same paragraph", () => {
    const paragraph = {
      html: "One two three four.",
      text: "One two three four.",
    };
    const oneStart = 0;
    const threeStart = paragraph.text.indexOf("three");
    const html = mergeHighlightsIntoHtml(paragraph, [
      { id: "a", start: oneStart, end: oneStart + 3, className: "a", order: 1 },
      {
        id: "b",
        start: threeStart,
        end: threeStart + 5,
        className: "b",
        order: 2,
      },
    ]);
    expect(html).toBe(
      '<mark data-highlight-id="a" class="a">One</mark> two <mark data-highlight-id="b" class="b">three</mark> four.',
    );
  });

  it("never adds, drops, or reorders characters — textContent round-trips to the original text", () => {
    const text = "The form of wood is altered, by making a table out of it.";
    const html =
      "The <em>form of wood</em> is altered, by making a table out of it.";
    const ranges = [
      { id: "a", start: 4, end: 20, className: "a", order: 1 }, // crosses the </em> boundary
      { id: "b", start: 30, end: 44, className: "b", order: 2 }, // plain text only
    ];
    const merged = mergeHighlightsIntoHtml({ html, text }, ranges);
    expect(textContentOf(merged)).toBe(text);
  });

  it("renders two highlights that merely touch (one's end is the other's start) as two separate sibling marks, not nested", () => {
    const paragraph = {
      html: "One two three four.",
      text: "One two three four.",
    };
    const html = mergeHighlightsIntoHtml(paragraph, [
      { id: "a", start: 0, end: 8, className: "a", order: 1 }, // "One two "
      { id: "b", start: 8, end: 13, className: "b", order: 2 }, // "three"
    ]);
    expect(html).toBe(
      '<mark data-highlight-id="a" class="a">One two </mark><mark data-highlight-id="b" class="b">three</mark> four.',
    );
  });

  it("preserves nested inline tags (strong > em) inside a highlight", () => {
    const paragraph = {
      html: "A <strong><em>very bold</em></strong> word.",
      text: "A very bold word.",
    };
    const start = paragraph.text.indexOf("bold");
    const end = start + "bold".length;
    const html = mergeHighlightsIntoHtml(paragraph, [
      { id: "h1", start, end, className: "hl", order: 1 },
    ]);
    expect(html).toBe(
      'A <strong><em>very </em></strong><mark data-highlight-id="h1" class="hl"><strong><em>bold</em></strong></mark> word.',
    );
  });

  it("ignores an empty range (start === end) rather than rendering an empty mark", () => {
    const paragraph = { html: "Hello world.", text: "Hello world." };
    const html = mergeHighlightsIntoHtml(paragraph, [
      { id: "a", start: 5, end: 5, className: "a", order: 1 },
    ]);
    expect(html).toBe(paragraph.html);
  });

  it("ignores a malformed range (start > end) rather than throwing", () => {
    const paragraph = { html: "Hello world.", text: "Hello world." };
    const html = mergeHighlightsIntoHtml(paragraph, [
      { id: "a", start: 10, end: 2, className: "a", order: 1 },
    ]);
    expect(html).toBe(paragraph.html);
  });

  it("clamps an out-of-bounds end offset to the end of the text instead of throwing", () => {
    const paragraph = { html: "Hello world.", text: "Hello world." };
    const html = mergeHighlightsIntoHtml(paragraph, [
      { id: "a", start: 6, end: 9999, className: "a", order: 1 },
    ]);
    expect(html).toBe(
      'Hello <mark data-highlight-id="a" class="a">world.</mark>',
    );
  });

  it("clamps a negative start offset to the start of the text instead of throwing", () => {
    const paragraph = { html: "Hello world.", text: "Hello world." };
    const html = mergeHighlightsIntoHtml(paragraph, [
      { id: "a", start: -5, end: 5, className: "a", order: 1 },
    ]);
    expect(html).toBe(
      '<mark data-highlight-id="a" class="a">Hello</mark> world.',
    );
  });

  it("is order-independent — unsorted highlight input renders the same as sorted input, for non-overlapping ranges", () => {
    const paragraph = {
      html: "One two three four five.",
      text: "One two three four five.",
    };
    const inOrder = [
      { id: "b", start: 0, end: 3, className: "b", order: 1 },
      { id: "a", start: 14, end: 18, className: "a", order: 2 },
    ];
    const reversed = [inOrder[1], inOrder[0]];
    expect(mergeHighlightsIntoHtml(paragraph, reversed)).toBe(
      mergeHighlightsIntoHtml(paragraph, inOrder),
    );
  });

  it("is order-independent for overlapping ranges too — grouping is by highlight id set, not input array position", () => {
    const paragraph = {
      html: "One two three four five.",
      text: "One two three four five.",
    };
    const a = { id: "a", start: 0, end: 13, className: "a", order: 1 }; // "One two three"
    const b = { id: "b", start: 8, end: 18, className: "b", order: 2 }; // "three four"
    expect(mergeHighlightsIntoHtml(paragraph, [b, a])).toBe(
      mergeHighlightsIntoHtml(paragraph, [a, b]),
    );
  });

  it("renders two partially overlapping ranges as three pieces, the shared middle nested with the newer highlight outermost", () => {
    const paragraph = {
      html: "One two three four five.",
      text: "One two three four five.",
    };
    const ranges = [
      { id: "a", start: 0, end: 13, className: "a", order: 1 }, // "One two three" — older
      { id: "b", start: 8, end: 18, className: "b", order: 2 }, // "three four" — newer
    ];
    expect(mergeHighlightsIntoHtml(paragraph, ranges)).toBe(
      '<mark data-highlight-id="a" class="a">One two </mark>' +
        '<mark data-highlight-id="b" class="b"><mark data-highlight-id="a" class="a">three</mark></mark>' +
        '<mark data-highlight-id="b" class="b"> four</mark> five.',
    );
  });

  it("renders one range fully nested inside another as nested marks in the shared middle, with the newer range as the outer wrapper throughout", () => {
    const paragraph = {
      html: "One two three four five.",
      text: "One two three four five.",
    };
    const ranges = [
      { id: "outer", start: 0, end: 19, className: "outer", order: 2 }, // "One two three four " — newer, renders outermost
      { id: "inner", start: 4, end: 8, className: "inner", order: 1 }, // "two " — older, renders innermost
    ];
    expect(mergeHighlightsIntoHtml(paragraph, ranges)).toBe(
      '<mark data-highlight-id="outer" class="outer">One </mark>' +
        '<mark data-highlight-id="outer" class="outer"><mark data-highlight-id="inner" class="inner">two </mark></mark>' +
        '<mark data-highlight-id="outer" class="outer">three four </mark>five.',
    );
  });

  it("renders two ranges over the exact same span as two nested marks — exact duplicates are allowed, not rejected", () => {
    const paragraph = { html: "Hello world.", text: "Hello world." };
    const ranges = [
      { id: "a", start: 0, end: 5, className: "a", order: 1 }, // older
      { id: "b", start: 0, end: 5, className: "b", order: 2 }, // newer, different role/colour
    ];
    expect(mergeHighlightsIntoHtml(paragraph, ranges)).toBe(
      '<mark data-highlight-id="b" class="b"><mark data-highlight-id="a" class="a">Hello</mark></mark> world.',
    );
  });

  it("stacks three overlapping ranges three deep, newest outermost, in the shared middle only", () => {
    const paragraph = { html: "ABCDEFGHIJ", text: "ABCDEFGHIJ" };
    const ranges = [
      { id: "r1", start: 0, end: 10, className: "c1", order: 1 }, // widest, oldest
      { id: "r2", start: 2, end: 8, className: "c2", order: 2 },
      { id: "r3", start: 4, end: 6, className: "c3", order: 3 }, // narrowest, newest
    ];
    expect(mergeHighlightsIntoHtml(paragraph, ranges)).toBe(
      '<mark data-highlight-id="r1" class="c1">AB</mark>' +
        '<mark data-highlight-id="r2" class="c2"><mark data-highlight-id="r1" class="c1">CD</mark></mark>' +
        '<mark data-highlight-id="r3" class="c3"><mark data-highlight-id="r2" class="c2">' +
        '<mark data-highlight-id="r1" class="c1">EF</mark></mark></mark>' +
        '<mark data-highlight-id="r2" class="c2"><mark data-highlight-id="r1" class="c1">GH</mark></mark>' +
        '<mark data-highlight-id="r1" class="c1">IJ</mark>',
    );
  });

  it(`caps nesting at MAX_HIGHLIGHT_STACK_DEPTH (${MAX_HIGHLIGHT_STACK_DEPTH}), keeping the newest and dropping the oldest from the visual stack`, () => {
    const paragraph = { html: "Hello", text: "Hello" };
    const ranges = [
      { id: "r1", start: 0, end: 5, className: "c1", order: 1 }, // oldest — should be dropped from rendering
      { id: "r2", start: 0, end: 5, className: "c2", order: 2 },
      { id: "r3", start: 0, end: 5, className: "c3", order: 3 },
      { id: "r4", start: 0, end: 5, className: "c4", order: 4 }, // newest
    ];
    const merged = mergeHighlightsIntoHtml(paragraph, ranges);
    expect(merged).toBe(
      '<mark data-highlight-id="r4" class="c4"><mark data-highlight-id="r3" class="c3">' +
        '<mark data-highlight-id="r2" class="c2">Hello</mark></mark></mark>',
    );
    expect(merged).not.toContain('data-highlight-id="r1"');
    expect((merged.match(/<mark /g) ?? []).length).toBe(
      MAX_HIGHLIGHT_STACK_DEPTH,
    );
  });

  it("preserves a footnote marker's data-footnote-ref through a highlight elsewhere in the paragraph", () => {
    // The marker itself isn't covered by the highlight — ReadingParagraph's
    // own marker-scanning effect (querySelectorAll("sup[data-footnote-ref]"))
    // has to still find it after a highlight merge rebuilds the DOM, or the
    // footnote's popover silently stops working the moment any text in the
    // paragraph gets highlighted.
    const paragraph = {
      html: 'Call me Ishmael.<sup data-footnote-ref="note-1">1</sup>',
      text: "Call me Ishmael.1",
    };
    const start = paragraph.text.indexOf("Ishmael");
    const end = start + "Ishmael".length;
    const merged = mergeHighlightsIntoHtml(paragraph, [
      { id: "h1", start, end, className: "hl", order: 1 },
    ]);
    expect(merged).toBe(
      'Call me <mark data-highlight-id="h1" class="hl">Ishmael</mark>.' +
        '<sup data-footnote-ref="note-1">1</sup>',
    );
  });

  it("preserves data-footnote-ref even when the highlight covers the marker itself", () => {
    const paragraph = {
      html: 'Call me Ishmael.<sup data-footnote-ref="note-1">1</sup>',
      text: "Call me Ishmael.1",
    };
    const merged = mergeHighlightsIntoHtml(paragraph, [
      {
        id: "h1",
        start: 0,
        end: paragraph.text.length,
        className: "hl",
        order: 1,
      },
    ]);
    expect(merged).toContain('<sup data-footnote-ref="note-1">1</sup>');
  });
});
