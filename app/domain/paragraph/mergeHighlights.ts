import { parseHTML } from "linkedom";

/**
 * A range into a paragraph's `text` — [start, end) — to wrap in a `<mark>`.
 * `className` is the caller's to choose (role-based colour is #8's
 * concern, not this module's: invariant 1 says terracotta is the Rig's,
 * sage is your hand, and this function has no opinion on which is which).
 */
export type HighlightRange = { start: number; end: number; className: string };

type Run = { text: string; tags: string[] };

function isTextNode(node: Node): node is Text {
  return node.nodeType === 3;
}

function isElementNode(node: Node): node is Element {
  return node.nodeType === 1;
}

/**
 * Flattens a DOM subtree into text runs, each carrying the stack of tag
 * names (outermost first) it's wrapped in. This is a pre-order walk — the
 * same order `Element.textContent` concatenates in — so runs laid end to
 * end reproduce exactly the paragraph's own `text`. That agreement is the
 * whole reason this function exists: highlight offsets are into `text`,
 * and this is what lets them land on the right characters in `html`.
 */
function flattenRuns(root: Node): Run[] {
  const runs: Run[] = [];
  function walk(node: Node, tags: string[]) {
    for (const child of Array.from(node.childNodes)) {
      if (isTextNode(child)) {
        if (child.data.length > 0) runs.push({ text: child.data, tags });
      } else if (isElementNode(child)) {
        walk(child, [...tags, child.tagName.toLowerCase()]);
      }
    }
  }
  walk(root, []);
  return runs;
}

type Piece = { text: string; tags: string[]; highlight: HighlightRange | null };

/**
 * Splits runs at every highlight boundary that falls inside one, so each
 * resulting piece is either wholly inside exactly one highlight range or
 * wholly outside all of them. This is what lets a highlight start in the
 * middle of an existing `<em>` and end after it: the `<em>` run gets cut
 * into an unhighlighted piece and a highlighted piece, each still carrying
 * the `em` tag, rather than requiring the mark and the em to cross.
 *
 * Assumes highlight ranges don't overlap each other — nothing asks this
 * module to render two highlights over the same character yet.
 */
function splitRunsAtHighlights(runs: Run[], highlights: HighlightRange[]): Piece[] {
  const pieces: Piece[] = [];
  let offset = 0;

  for (const run of runs) {
    const runStart = offset;
    const runEnd = offset + run.text.length;

    const cuts = new Set<number>([0, run.text.length]);
    for (const h of highlights) {
      if (h.start > runStart && h.start < runEnd) cuts.add(h.start - runStart);
      if (h.end > runStart && h.end < runEnd) cuts.add(h.end - runStart);
    }
    const sortedCuts = Array.from(cuts).sort((a, b) => a - b);

    for (let i = 0; i < sortedCuts.length - 1; i++) {
      const from = sortedCuts[i];
      const to = sortedCuts[i + 1];
      if (from === to) continue;
      const pieceStart = runStart + from;
      const pieceEnd = runStart + to;
      const covering = highlights.find((h) => h.start <= pieceStart && h.end >= pieceEnd) ?? null;
      pieces.push({ text: run.text.slice(from, to), tags: run.tags, highlight: covering });
    }

    offset = runEnd;
  }

  return pieces;
}

/**
 * Wraps the given ranges of `paragraph.text` in `<mark>` elements within
 * `paragraph.html`, preserving whatever inline markup (em, strong, ...) is
 * already there. Built by constructing a fresh DOM (via linkedom) rather
 * than splicing HTML strings by hand, so there's no manual escaping to get
 * wrong: every text run is a real Text node, and the browser-grade
 * serializer produces the final markup.
 *
 * Trust boundary: `paragraph.html` must already be sanitized (it is —
 * app/domain/epub/sanitizeHtml.ts, at ingest). This function only adds
 * `<mark>` wrappers around existing content; it never accepts a tag name
 * or attribute from `highlights` beyond a CSS class name, so it can't be
 * used to smuggle arbitrary markup into the page.
 */
export function mergeHighlightsIntoHtml(
  paragraph: { html: string; text: string },
  highlights: HighlightRange[],
): string {
  if (highlights.length === 0) return paragraph.html;

  const { document } = parseHTML(`<div>${paragraph.html}</div>`);
  const root = document.querySelector("div")!;
  const runs = flattenRuns(root);
  const pieces = splitRunsAtHighlights(runs, highlights);

  function buildPieceNode(piece: Piece): Node {
    let node: Node = document.createTextNode(piece.text);
    for (const tag of [...piece.tags].reverse()) {
      const el = document.createElement(tag);
      el.appendChild(node);
      node = el;
    }
    return node;
  }

  const out = document.createElement("div");
  // Group consecutive pieces covered by the same highlight so a range that
  // spans several pieces (e.g. across an existing <em> boundary) gets one
  // <mark>, not several adjacent ones — the two are visually similar but
  // not the same shape, and a screen reader or CSS border-radius would
  // notice the difference.
  let i = 0;
  while (i < pieces.length) {
    const highlight = pieces[i].highlight;
    if (!highlight) {
      out.appendChild(buildPieceNode(pieces[i]));
      i += 1;
      continue;
    }
    const mark = document.createElement("mark");
    mark.className = highlight.className;
    while (i < pieces.length && pieces[i].highlight === highlight) {
      mark.appendChild(buildPieceNode(pieces[i]));
      i += 1;
    }
    out.appendChild(mark);
  }

  return out.innerHTML;
}
