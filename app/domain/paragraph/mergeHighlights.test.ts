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
});
