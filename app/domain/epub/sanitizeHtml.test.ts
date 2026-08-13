import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { sanitizeParagraph } from "./sanitizeHtml";

function paragraphFrom(innerMarkup: string): Element {
  const { document } = parseHTML(
    `<html><body><p>${innerMarkup}</p></body></html>`,
  );
  return document.querySelector("p")!;
}

describe("sanitizeParagraph", () => {
  it("keeps allow-listed inline tags, stripping their attributes", () => {
    const p = paragraphFrom('Hello <em class="x" epub:type="y">world</em>.');
    const { html } = sanitizeParagraph(p);
    expect(html).toBe("Hello <em>world</em>.");
  });

  it("unwraps disallowed tags — keeps the text, drops the tag", () => {
    const p = paragraphFrom(
      '<span>Smith</span> and <abbr title="Mister">Mr.</abbr>',
    );
    const { html, text } = sanitizeParagraph(p);
    expect(html).toBe("Smith and Mr.");
    expect(text).toBe("Smith and Mr.");
  });

  it("collapses pretty-printed whitespace to single spaces without merging words", () => {
    const p = paragraphFrom(
      "\n    Hello\n    <em>world</em>,\n    Mr. Smith.\n  ",
    );
    const { html, text } = sanitizeParagraph(p);
    expect(html).toBe("Hello <em>world</em>, Mr. Smith.");
    expect(text).toBe("Hello world, Mr. Smith.");
  });

  it("keeps html and text in agreement — the property #6 depends on", () => {
    const p = paragraphFrom(
      'The <em>form</em> of <span epub:type="x">wood</span>, altered.',
    );
    const { html, text } = sanitizeParagraph(p);
    // text is html with tags removed and entities decoded — if these ever
    // disagree, a highlight anchored to a `text` offset would land on the
    // wrong character when rendered from `html`.
    expect(text).toBe(html.replace(/<\/?em>/g, ""));
  });

  it("trims only the outer edges — a leading/trailing tag keeps its own inner spacing", () => {
    const p = paragraphFrom("  <em>Emphasis</em> at the start.  ");
    const { html, text } = sanitizeParagraph(p);
    expect(html).toBe("<em>Emphasis</em> at the start.");
    expect(text).toBe("Emphasis at the start.");
  });

  it("collapses a doubled space when an inline tag has its own internal padding", () => {
    // The em's own text has leading/trailing padding and isn't the
    // outermost node in the paragraph — the naive "only trim the first and
    // last text node" rule would leave two spaces back-to-back at each tag
    // boundary here, collapsed only visually by a browser rather than in
    // the stored strings a highlight offset indexes into.
    const p = paragraphFrom("Hello <em> world </em> today.");
    const { html, text } = sanitizeParagraph(p);
    expect(html).not.toMatch(/ {2}/);
    expect(text).toBe("Hello world today.");
    expect(text).toBe(html.replace(/<\/?em>/g, ""));
  });
});
