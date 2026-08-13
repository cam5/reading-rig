/**
 * A narrow allow-list of inline markup, deliberately not the full set
 * Standard Ebooks' source might contain (abbr, span, a, small, ...). Widen
 * this only when something concrete needs it — an unlisted tag is
 * unwrapped (its text kept, the tag dropped) rather than causing an error
 * or silently losing content.
 */
const ALLOWED_TAGS = new Set(["em", "i", "strong", "b", "sup", "sub"]);

/**
 * A footnote body is block content in its own right (see #138) — often
 * more than one <p>, sometimes a nested <blockquote> (a quoted verse), a
 * <br> line break, or a <cite>/<abbr> — not the single-inline-line shape
 * ALLOWED_TAGS was built for. A separate, wider allow-list rather than
 * widening ALLOWED_TAGS itself, which would let paragraph content start
 * carrying block-level tags it was never meant to.
 */
const FOOTNOTE_BODY_ALLOWED_TAGS = new Set([
  "p",
  "blockquote",
  "br",
  "em",
  "i",
  "strong",
  "b",
  "sup",
  "sub",
  "cite",
  "abbr",
  "span",
]);

function isTextNode(node: unknown): node is Text {
  return (node as Node).nodeType === 3;
}

function isElementNode(node: unknown): node is Element {
  return (node as Node).nodeType === 1;
}

function epubTypeTokens(el: Element): string[] {
  return (el.getAttribute("epub:type") ?? "").split(/\s+/).filter(Boolean);
}

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

/**
 * Strips every attribute, except `data-footnote-ref` — the one thing a
 * rewritten noteref marker (see rewriteFootnoteRefs) needs to carry
 * through the rest of sanitization, since it's the only link back to that
 * footnote's body once the original <a href> is gone.
 */
function stripAttributes(el: Element): void {
  for (const name of Array.from(el.attributes ?? []).map((a) => a.name)) {
    if (name === "data-footnote-ref") continue;
    el.removeAttribute(name);
  }
}

/**
 * Rewrites every `<a epub:type="noteref" href="...#note-1">1</a>` inside
 * the paragraph into `<sup data-footnote-ref="note-1">1</sup>` — see
 * #138. Sanitizing a raw `<a>` through the general allow-list below would
 * just unwrap it (no `a` in ALLOWED_TAGS), leaving an invisible bare
 * digit with no link back to its footnote body; this runs first so the
 * marker survives as a real, styleable, joinable element instead. The
 * href's fragment (not the anchor's own id="noteref-N") is the refId —
 * it's what actually matches the endnote body's own id="note-N" in
 * endnotes.xhtml.
 *
 * Returns every refId found, in document order, so the caller can record
 * which paragraph each footnote's marker landed in.
 */
function rewriteFootnoteRefs(paragraph: Element): string[] {
  const refIds: string[] = [];
  const noterefs = Array.from(paragraph.querySelectorAll("a")).filter((a) =>
    epubTypeTokens(a).includes("noteref"),
  );
  for (const anchor of noterefs) {
    const href = anchor.getAttribute("href") ?? "";
    const hashIndex = href.indexOf("#");
    const refId = hashIndex === -1 ? href : href.slice(hashIndex + 1);
    if (!refId) continue;
    const marker = paragraph.ownerDocument!.createElement("sup");
    marker.setAttribute("data-footnote-ref", refId);
    marker.textContent = anchor.textContent ?? "";
    anchor.replaceWith(marker);
    refIds.push(refId);
  }
  return refIds;
}

function collectTextNodes(node: Node, out: Text[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (isTextNode(child)) out.push(child);
    else collectTextNodes(child, out);
  }
}

/**
 * Collapses whitespace runs (source XHTML is pretty-printed, so a text
 * node can carry newlines and indentation) to a single space, trims the
 * outer-facing edge of the paragraph (the start of the first text node,
 * the end of the last), and — since every surviving tag is inline, so text
 * nodes are always visually adjacent regardless of what sits between them
 * — drops a node's own leading space whenever the previous node already
 * ends in one. Without that last step, an inline tag with its own internal
 * padding ("Hello <em> world </em> today") would leave a doubled space
 * sitting at the boundary: collapsed away visually by a browser, but
 * present verbatim in the stored html/text a highlight offset indexes into.
 */
function normalizeWhitespace(paragraph: Element): void {
  const textNodes: Text[] = [];
  collectTextNodes(paragraph, textNodes);
  textNodes.forEach((node, i) => {
    let value = node.data.replace(/\s+/g, " ");
    if (i === 0) value = value.replace(/^ /, "");
    if (i === textNodes.length - 1) value = value.replace(/ $/, "");
    if (i > 0 && textNodes[i - 1].data.endsWith(" ") && value.startsWith(" ")) {
      value = value.slice(1);
    }
    node.data = value;
  });
}

/**
 * Mutates the given `<p>` element in place — unwrapping disallowed tags,
 * stripping attributes from allowed ones, normalizing whitespace — then
 * reads `innerHTML` and `textContent` off that same final node. Doing
 * both reads from one mutated node, rather than computing them
 * independently, is what guarantees they agree: there is only one
 * normalized version of the paragraph, not two.
 *
 * `footnoteRefIds` (see rewriteFootnoteRefs) runs before the general
 * allow-list loop, so a noteref marker survives as a real element instead
 * of being unwrapped to a bare, unstyled digit.
 */
export function sanitizeParagraph(paragraph: Element): {
  html: string;
  text: string;
  footnoteRefIds: string[];
} {
  const footnoteRefIds = rewriteFootnoteRefs(paragraph);
  for (const el of Array.from(paragraph.querySelectorAll("*"))) {
    if (ALLOWED_TAGS.has(el.tagName.toLowerCase())) {
      stripAttributes(el);
    } else {
      unwrap(el);
    }
  }
  normalizeWhitespace(paragraph);
  return {
    html: paragraph.innerHTML,
    text: paragraph.textContent ?? "",
    footnoteRefIds,
  };
}

/**
 * Sanitizes one endnote's `<li>` body — see #138. Strips the backlink
 * anchor entirely first (the "↩" return-to-text arrow is page furniture
 * for the source epub's own back-matter list, not part of the footnote's
 * content), then applies the wider FOOTNOTE_BODY_ALLOWED_TAGS list.
 */
export function sanitizeFootnoteBody(li: Element): {
  html: string;
  text: string;
} {
  for (const anchor of Array.from(li.querySelectorAll("a")).filter((a) =>
    epubTypeTokens(a).includes("backlink"),
  )) {
    anchor.remove();
  }
  for (const el of Array.from(li.querySelectorAll("*"))) {
    if (FOOTNOTE_BODY_ALLOWED_TAGS.has(el.tagName.toLowerCase())) {
      stripAttributes(el);
    } else {
      unwrap(el);
    }
  }
  // The common case is a <p> that held nothing but the now-removed
  // backlink — left behind as an empty paragraph, which would otherwise
  // render as a stray blank line in the popover.
  for (const p of Array.from(li.querySelectorAll("p"))) {
    if (!p.textContent?.trim()) p.remove();
  }
  normalizeWhitespace(li);
  return { html: li.innerHTML, text: li.textContent ?? "" };
}
