/**
 * A narrow allow-list of inline markup, deliberately not the full set
 * Standard Ebooks' source might contain (abbr, span, a, small, ...). Widen
 * this only when something concrete needs it — an unlisted tag is
 * unwrapped (its text kept, the tag dropped) rather than causing an error
 * or silently losing content.
 */
const ALLOWED_TAGS = new Set(["em", "i", "strong", "b", "sup", "sub"]);

function isTextNode(node: unknown): node is Text {
  return (node as Node).nodeType === 3;
}

function isElementNode(node: unknown): node is Element {
  return (node as Node).nodeType === 1;
}

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

/** Strips every attribute — allowed tags carry no attributes through. */
function stripAttributes(el: Element): void {
  for (const name of Array.from(el.attributes ?? []).map((a) => a.name)) {
    el.removeAttribute(name);
  }
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
 */
export function sanitizeParagraph(paragraph: Element): {
  html: string;
  text: string;
} {
  for (const el of Array.from(paragraph.querySelectorAll("*"))) {
    if (ALLOWED_TAGS.has(el.tagName.toLowerCase())) {
      stripAttributes(el);
    } else {
      unwrap(el);
    }
  }
  normalizeWhitespace(paragraph);
  return { html: paragraph.innerHTML, text: paragraph.textContent ?? "" };
}
