import { parseHTML } from "linkedom";
import { rangesOverlap } from "./range";

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
 *
 * Assumes every element in the subtree wraps text (true of everything
 * `sanitizeHtml.ts`'s allow-list — em/i/strong/b/sup/sub — lets through
 * today). A childless, non-text element (e.g. a future `<br>`) would
 * contribute no run and so vanish silently from the output whenever a
 * highlight is present on the paragraph. If the allow-list ever grows to
 * include one, this function needs to learn to carry it through as a
 * zero-width piece rather than dropping it.
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

/**
 * Throws if any two *real* ranges (`start < end`) overlap under the same
 * half-open `[start, end)` convention `covering` uses elsewhere in this
 * module — including two ranges that are exact duplicates of each other.
 * Malformed (`start > end`) and empty (`start === end`) ranges are
 * deliberately excluded: they're already inert no-ops (no piece can ever
 * satisfy `start <= pieceStart && end >= pieceEnd` for a non-empty piece
 * when the range itself is empty or inverted), so leaving them out of this
 * check preserves that permissive, crash-free handling rather than turning
 * harmless bad input into a hard failure.
 *
 * Two ranges that merely touch (one's `end` equals the other's `start`)
 * are not overlapping — they render as two separate, adjacent `<mark>`s,
 * which is correct and intentional.
 *
 * This exists because silently mis-rendering an overlap is worse than
 * refusing to render it: without this guard, `covering`'s first-match
 * behaviour attributes the overlapping region to whichever range happens
 * to come first in the input array, and a range fully nested inside
 * another disappears from the output entirely. A highlight is anchored to
 * a paragraph by exact offsets — landing on the wrong character (or not
 * landing at all) needs to be loud, not a silent rendering quirk.
 */
function assertNoOverlaps(highlights: HighlightRange[]): void {
  const real = highlights.filter((h) => h.start < h.end);
  for (let i = 0; i < real.length; i++) {
    for (let j = i + 1; j < real.length; j++) {
      const a = real[i];
      const b = real[j];
      if (rangesOverlap(a, b)) {
        throw new Error(
          `mergeHighlightsIntoHtml: overlapping highlight ranges [${a.start}, ${a.end}) and ` +
            `[${b.start}, ${b.end}) — this module renders exactly one highlight per character ` +
            `and has no defined behaviour for overlaps. Resolve the overlap before calling, or ` +
            `extend this function to support it explicitly.`,
        );
      }
    }
  }
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
 * Requires highlight ranges not to overlap each other — see
 * `assertNoOverlaps`, which `mergeHighlightsIntoHtml` runs before this —
 * because `covering` below takes the *first* array match for a piece, with
 * no defined behaviour for a piece two ranges both claim. Nothing asks this
 * module to render two highlights over the same character (yet); when that
 * changes, this is where stacked/merged highlight rendering would need to
 * be designed in, not silently inferred from array order.
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
 *
 * Throws if any two given ranges overlap (see `assertNoOverlaps`) — this
 * function has no defined behaviour for two highlights over the same
 * character, so it refuses rather than guessing.
 */
export function mergeHighlightsIntoHtml(
  paragraph: { html: string; text: string },
  highlights: HighlightRange[],
): string {
  if (highlights.length === 0) return paragraph.html;
  assertNoOverlaps(highlights);

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
