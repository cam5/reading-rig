import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { sanitizeFootnoteBody, sanitizeParagraph } from "./sanitizeHtml";

function paragraphFrom(innerMarkup: string): Element {
  const { document } = parseHTML(
    `<html><body><p>${innerMarkup}</p></body></html>`,
  );
  return document.querySelector("p")!;
}

function footnoteLiFrom(innerMarkup: string): Element {
  const { document } = parseHTML(
    `<html><body><ol><li id="note-1" xmlns:epub="http://www.idpf.org/2007/ops">${innerMarkup}</li></ol></body></html>`,
  );
  return document.querySelector("li")!;
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

  // #138: a noteref anchor must survive as a real, joinable marker, not be
  // unwrapped to a bare, unstyled digit like any other unlisted tag would.
  it("rewrites a noteref anchor into a <sup data-footnote-ref> marker", () => {
    const p = paragraphFrom(
      'The end.<a epub:type="noteref" href="endnotes.xhtml#note-3" id="noteref-3">3</a>',
    );
    const { html, footnoteRefIds } = sanitizeParagraph(p);
    expect(html).toBe('The end.<sup data-footnote-ref="note-3">3</sup>');
    expect(footnoteRefIds).toEqual(["note-3"]);
  });

  it("uses the href's fragment as the refId, not the anchor's own id", () => {
    // Standard Ebooks' own convention: the marker's id is "noteref-N", the
    // endnote body's id is "note-N" — only the href fragment actually
    // matches the body, so that's what must become data-footnote-ref.
    const p = paragraphFrom(
      '<a epub:type="noteref" href="endnotes.xhtml#note-7" id="noteref-3">3</a>',
    );
    const { footnoteRefIds } = sanitizeParagraph(p);
    expect(footnoteRefIds).toEqual(["note-7"]);
  });

  it("leaves a non-noteref anchor to the ordinary unwrap path", () => {
    const p = paragraphFrom('<a href="https://example.com">a link</a>');
    const { html, footnoteRefIds } = sanitizeParagraph(p);
    expect(html).toBe("a link");
    expect(footnoteRefIds).toEqual([]);
  });

  it("returns an empty footnoteRefIds array for a paragraph with no noterefs", () => {
    const p = paragraphFrom("Just prose.");
    expect(sanitizeParagraph(p).footnoteRefIds).toEqual([]);
  });
});

describe("sanitizeFootnoteBody", () => {
  it("strips the backlink anchor and any now-empty paragraph it leaves behind", () => {
    const li = footnoteLiFrom(
      '<p>Guillotine. <a epub:type="backlink" href="chapter-35.xhtml#noteref-6">↩</a></p>',
    );
    const { html, text } = sanitizeFootnoteBody(li);
    expect(html).toBe("<p>Guillotine.</p>");
    expect(text).toBe("Guillotine.");
  });

  it("allows block content a paragraph's own allow-list would reject — blockquote, br, cite, abbr", () => {
    const li = footnoteLiFrom(
      "<blockquote><p><span>Line one,</span><br/><span>line two.</span></p></blockquote>" +
        "<p><cite>—<i>The Abbot</i>, <abbr>ch.</abbr></cite></p>",
    );
    const { html } = sanitizeFootnoteBody(li);
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<br>");
    expect(html).toContain("<cite>—<i>The Abbot</i>, <abbr>ch.</abbr></cite>");
  });

  it("still unwraps a tag outside even the wider allow-list", () => {
    const li = footnoteLiFrom(
      '<p>Knocked on the head<small class="junk">, allegedly</small>.</p>',
    );
    const { html } = sanitizeFootnoteBody(li);
    expect(html).toBe("<p>Knocked on the head, allegedly.</p>");
  });
});
