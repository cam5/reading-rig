import { parseHTML } from "linkedom";

/**
 * A range into a paragraph's `text` — [start, end) — to wrap in a `<mark>`.
 * `className` is the caller's to choose (role-based colour is
 * highlightRole.ts's concern, not this module's — this function has no
 * opinion on which role gets which colour). `id` and `order` are likewise
 * the caller's: `id` becomes the rendered
 * `data-highlight-id`, `order` decides nesting when ranges overlap (higher
 * = renders more outer). Reading Rig's caller passes the underlying
 * Highlight's `id` and `createdAt.getTime()` — newest outermost — but this
 * module has no opinion on what "order" means, same as it has none about
 * colour.
 */
export type HighlightRange = {
  id: string;
  start: number;
  end: number;
  className: string;
  order: number;
};

/**
 * Caps visual nesting so a pathological many-deep overlap doesn't render as
 * one oversaturated/near-solid mark. Purely a rendering cap — never drops
 * highlight data, only how many of a piece's covering highlights get their
 * own nested <mark>. The newest (highest `order`) ones win, since order is
 * "newest outermost" and being visually buried is the actual failure mode
 * this guards against.
 */
export const MAX_HIGHLIGHT_STACK_DEPTH = 3;

// A tag name plus the one attribute this module cares about preserving —
// `data-footnote-ref` (see sanitizeHtml.ts's own carve-out for it). Not a
// general attribute bag: mergeHighlightsIntoHtml only ever handles
// sanitizeHtml.ts's narrow allow-list of inline tags, and a footnote
// marker's own data attribute is the only one of those that means
// something to code downstream (ReadingParagraph's marker-scanning
// effect) rather than just being presentational.
type TagWithAttrs = { tag: string; footnoteRef?: string };

type Run = { text: string; tags: TagWithAttrs[] };

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
  function walk(node: Node, tags: TagWithAttrs[]) {
    for (const child of Array.from(node.childNodes)) {
      if (isTextNode(child)) {
        if (child.data.length > 0) runs.push({ text: child.data, tags });
      } else if (isElementNode(child)) {
        const footnoteRef =
          child.getAttribute("data-footnote-ref") ?? undefined;
        walk(child, [
          ...tags,
          { tag: child.tagName.toLowerCase(), footnoteRef },
        ]);
      }
    }
  }
  walk(root, []);
  return runs;
}

type Piece = {
  text: string;
  tags: TagWithAttrs[];
  highlights: HighlightRange[];
};

/**
 * Splits runs at every highlight boundary that falls inside one, so each
 * resulting piece is either wholly inside the same set of highlight ranges
 * or wholly outside a given range — never straddling a boundary. This is
 * what lets a highlight start in the middle of an existing `<em>` and end
 * after it: the `<em>` run gets cut into an unhighlighted piece and a
 * highlighted piece, each still carrying the `em` tag, rather than
 * requiring the mark and the em to cross.
 *
 * A piece may be covered by zero, one, or several highlights —
 * `mergeHighlightsIntoHtml` groups pieces by their *set* of covering
 * highlights and nests one `<mark>` per covering highlight, outermost
 * (highest `order`) to innermost.
 */
function splitRunsAtHighlights(
  runs: Run[],
  highlights: HighlightRange[],
): Piece[] {
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
      const covering = highlights.filter(
        (h) => h.start <= pieceStart && h.end >= pieceEnd,
      );
      pieces.push({
        text: run.text.slice(from, to),
        tags: run.tags,
        highlights: covering,
      });
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
 * or attribute from `highlights` beyond a CSS class name and a
 * `data-highlight-id` — the latter is always a server-generated cuid
 * (`Highlight.id`), never user-authored text — so it can't be used to
 * smuggle arbitrary markup into the page.
 *
 * Every shape of overlap (partial, nested, exact-duplicate) renders as
 * nested `<mark>`s; there is no rejection path left in this module.
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
    for (const { tag, footnoteRef } of [...piece.tags].reverse()) {
      const el = document.createElement(tag);
      if (footnoteRef) el.setAttribute("data-footnote-ref", footnoteRef);
      el.appendChild(node);
      node = el;
    }
    return node;
  }

  // Canonical key for "these pieces are covered by exactly the same
  // highlights" — order-independent (sorted by id), so grouping doesn't
  // depend on the order `covering` happened to find them in.
  function highlightSetKey(pieceHighlights: HighlightRange[]): string {
    return pieceHighlights
      .map((h) => h.id)
      .slice()
      .sort()
      .join(",");
  }

  // Wraps `groupPieces`' own nodes (each already carrying its inline tags,
  // e.g. <em>) in one nested <mark> per highlight covering them, outermost
  // first by `order` (newest outermost), capped to MAX_HIGHLIGHT_STACK_DEPTH
  // — the newest layers win when there are more covering highlights than
  // the cap, since being visually buried under older highlights is the
  // failure this cap exists to prevent, and every highlight stays in the
  // underlying data regardless of how many get their own mark here. Two
  // highlights created in the same millisecond tie on `order`; `sort` is
  // stable (ES2019+), so ties resolve to input array order — deterministic,
  // just an arbitrary-but-stable tiebreak.
  function buildStackedMark(
    groupPieces: Piece[],
    groupHighlights: HighlightRange[],
  ): Node {
    const outermostFirst = [...groupHighlights]
      .sort((a, b) => b.order - a.order)
      .slice(0, MAX_HIGHLIGHT_STACK_DEPTH);

    let node: Node = document.createDocumentFragment();
    for (const piece of groupPieces) node.appendChild(buildPieceNode(piece));

    for (const h of [...outermostFirst].reverse()) {
      // build innermost-out
      const mark = document.createElement("mark");
      mark.className = h.className;
      mark.setAttribute("data-highlight-id", h.id);
      mark.appendChild(node);
      node = mark;
    }
    return node;
  }

  const out = document.createElement("div");
  // Group consecutive pieces covered by the same *set* of highlights so a
  // range that spans several pieces (e.g. across an existing <em>
  // boundary) gets one <mark>, not several adjacent ones — the two are
  // visually similar but not the same shape, and a screen reader or CSS
  // border-radius would notice the difference.
  let i = 0;
  while (i < pieces.length) {
    if (pieces[i].highlights.length === 0) {
      out.appendChild(buildPieceNode(pieces[i]));
      i += 1;
      continue;
    }
    const key = highlightSetKey(pieces[i].highlights);
    const groupHighlights = pieces[i].highlights;
    const group: Piece[] = [];
    while (
      i < pieces.length &&
      pieces[i].highlights.length > 0 &&
      highlightSetKey(pieces[i].highlights) === key
    ) {
      group.push(pieces[i]);
      i += 1;
    }
    out.appendChild(buildStackedMark(group, groupHighlights));
  }

  return out.innerHTML;
}
