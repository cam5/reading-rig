import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { mergeHighlightsIntoHtml } from "./mergeHighlights";

function textContentOf(html: string): string {
  const { document } = parseHTML(`<div>${html}</div>`);
  return document.querySelector("div")!.textContent ?? "";
}

describe("mergeHighlightsIntoHtml", () => {
  it("passes html through unchanged when there are no highlights", () => {
    const paragraph = { html: "Hello <em>world</em>.", text: "Hello world." };
    expect(mergeHighlightsIntoHtml(paragraph, [])).toBe(paragraph.html);
  });

  it("wraps a range entirely within plain text", () => {
    const paragraph = { html: "Hello world.", text: "Hello world." };
    // "world" is offsets 6-11
    const html = mergeHighlightsIntoHtml(paragraph, [
      { start: 6, end: 11, className: "hl" },
    ]);
    expect(html).toBe('Hello <mark class="hl">world</mark>.');
  });

  it("the ticket's own fiddly part: a highlight that starts inside an existing <em> and ends after it", () => {
    // "The form of wood is altered" (em covers "form of wood")
    const text = "The form of wood is altered.";
    const html = "The <em>form of wood</em> is altered.";
    // Highlight "wood is" — starts inside the </em> run, ends outside it.
    const start = text.indexOf("wood is");
    const end = start + "wood is".length;
    const merged = mergeHighlightsIntoHtml({ html, text }, [
      { start, end, className: "hl" },
    ]);
    // "wood" stays wrapped in <em> (it was already), "is" is plain — both
    // inside the mark; "form of " stays em'd and unhighlighted.
    expect(merged).toBe(
      'The <em>form of </em><mark class="hl"><em>wood</em> is</mark> altered.',
    );
  });

  it("wraps a range that exactly matches an existing tag's bounds", () => {
    const paragraph = { html: "Hello <em>world</em>.", text: "Hello world." };
    const start = paragraph.text.indexOf("world");
    const end = start + "world".length;
    const html = mergeHighlightsIntoHtml(paragraph, [{ start, end, className: "hl" }]);
    expect(html).toBe('Hello <mark class="hl"><em>world</em></mark>.');
  });

  it("renders multiple non-overlapping highlights in the same paragraph", () => {
    const paragraph = { html: "One two three four.", text: "One two three four." };
    const oneStart = 0;
    const threeStart = paragraph.text.indexOf("three");
    const html = mergeHighlightsIntoHtml(paragraph, [
      { start: oneStart, end: oneStart + 3, className: "a" },
      { start: threeStart, end: threeStart + 5, className: "b" },
    ]);
    expect(html).toBe(
      '<mark class="a">One</mark> two <mark class="b">three</mark> four.',
    );
  });

  it("never adds, drops, or reorders characters — textContent round-trips to the original text", () => {
    const text = "The form of wood is altered, by making a table out of it.";
    const html = "The <em>form of wood</em> is altered, by making a table out of it.";
    const ranges = [
      { start: 4, end: 20, className: "a" }, // crosses the </em> boundary
      { start: 30, end: 44, className: "b" }, // plain text only
    ];
    const merged = mergeHighlightsIntoHtml({ html, text }, ranges);
    expect(textContentOf(merged)).toBe(text);
  });

  it("renders two highlights that merely touch (one's end is the other's start) as separate marks", () => {
    const paragraph = { html: "One two three four.", text: "One two three four." };
    const html = mergeHighlightsIntoHtml(paragraph, [
      { start: 0, end: 8, className: "a" }, // "One two "
      { start: 8, end: 13, className: "b" }, // "three"
    ]);
    expect(html).toBe('<mark class="a">One two </mark><mark class="b">three</mark> four.');
  });

  it("preserves nested inline tags (strong > em) inside a highlight", () => {
    const paragraph = { html: "A <strong><em>very bold</em></strong> word.", text: "A very bold word." };
    const start = paragraph.text.indexOf("bold");
    const end = start + "bold".length;
    const html = mergeHighlightsIntoHtml(paragraph, [{ start, end, className: "hl" }]);
    expect(html).toBe('A <strong><em>very </em></strong><mark class="hl"><strong><em>bold</em></strong></mark> word.');
  });

  it("ignores an empty range (start === end) rather than rendering an empty mark", () => {
    const paragraph = { html: "Hello world.", text: "Hello world." };
    const html = mergeHighlightsIntoHtml(paragraph, [{ start: 5, end: 5, className: "a" }]);
    expect(html).toBe(paragraph.html);
  });

  it("ignores a malformed range (start > end) rather than throwing", () => {
    const paragraph = { html: "Hello world.", text: "Hello world." };
    const html = mergeHighlightsIntoHtml(paragraph, [{ start: 10, end: 2, className: "a" }]);
    expect(html).toBe(paragraph.html);
  });

  it("clamps an out-of-bounds end offset to the end of the text instead of throwing", () => {
    const paragraph = { html: "Hello world.", text: "Hello world." };
    const html = mergeHighlightsIntoHtml(paragraph, [{ start: 6, end: 9999, className: "a" }]);
    expect(html).toBe('Hello <mark class="a">world.</mark>');
  });

  it("clamps a negative start offset to the start of the text instead of throwing", () => {
    const paragraph = { html: "Hello world.", text: "Hello world." };
    const html = mergeHighlightsIntoHtml(paragraph, [{ start: -5, end: 5, className: "a" }]);
    expect(html).toBe('<mark class="a">Hello</mark> world.');
  });

  it("is order-independent — unsorted highlight input renders the same as sorted input", () => {
    const paragraph = { html: "One two three four five.", text: "One two three four five." };
    const inOrder = [
      { start: 0, end: 3, className: "b" },
      { start: 14, end: 18, className: "a" },
    ];
    const reversed = [inOrder[1], inOrder[0]];
    expect(mergeHighlightsIntoHtml(paragraph, reversed)).toBe(
      mergeHighlightsIntoHtml(paragraph, inOrder),
    );
  });

  it("throws on two ranges that partially overlap, rather than silently misattributing the overlap", () => {
    const paragraph = { html: "One two three four five.", text: "One two three four five." };
    const ranges = [
      { start: 0, end: 13, className: "a" }, // "One two three"
      { start: 8, end: 18, className: "b" }, // "three four"
    ];
    expect(() => mergeHighlightsIntoHtml(paragraph, ranges)).toThrow(/overlapping/i);
  });

  it("throws when one range is fully nested inside another, rather than silently dropping the inner one", () => {
    const paragraph = { html: "One two three four five.", text: "One two three four five." };
    const ranges = [
      { start: 0, end: 20, className: "outer" },
      { start: 4, end: 8, className: "inner" },
    ];
    expect(() => mergeHighlightsIntoHtml(paragraph, ranges)).toThrow(/overlapping/i);
  });

  it("throws on two ranges over the exact same span, rather than silently dropping the second", () => {
    const paragraph = { html: "Hello world.", text: "Hello world." };
    const ranges = [
      { start: 0, end: 5, className: "a" },
      { start: 0, end: 5, className: "b" },
    ];
    expect(() => mergeHighlightsIntoHtml(paragraph, ranges)).toThrow(/overlapping/i);
  });
});
