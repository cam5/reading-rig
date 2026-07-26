/**
 * Resolves a browser selection Range into [start, end) character offsets
 * into a paragraph's `text` — the inverse of what mergeHighlights.ts does
 * with stored offsets. Takes a Range-shaped object (four readonly
 * properties `Range` already has) rather than a real `Range` instance:
 * linkedom's `Range` doesn't implement `setStart`/`setEnd`, so tests build
 * plain fixtures with these fields directly, and a real
 * `window.getSelection().getRangeAt(0)` satisfies the same shape at
 * runtime without any adapting.
 */
export type RangeLike = {
  startContainer: Node;
  startOffset: number;
  endContainer: Node;
  endOffset: number;
};

type TextRun = { node: Node; start: number; end: number };

function isTextNode(node: Node): boolean {
  return node.nodeType === 3;
}

/** Every text node under `root`, with its [start, end) in the
 * concatenated text — the same pre-order walk sanitizeHtml.ts's
 * normalizeWhitespace and mergeHighlights.ts's flattenRuns use, which is
 * what keeps this in agreement with `paragraph.text`. */
function collectTextRuns(root: Node): TextRun[] {
  const runs: TextRun[] = [];
  let offset = 0;
  function walk(node: Node) {
    for (const child of Array.from(node.childNodes)) {
      if (isTextNode(child)) {
        const length = (child as unknown as { data: string }).data.length;
        runs.push({ node: child, start: offset, end: offset + length });
        offset += length;
      } else {
        walk(child);
      }
    }
  }
  walk(root);
  return runs;
}

/**
 * A Range boundary point is (container, offset). If container is a Text
 * node, offset is a character offset within it — the common case for a
 * click-drag selection over rendered text. If container is anything else
 * (an Element), offset is a *child index* — the boundary sits just before
 * that child (or after the last child, if offset equals the child count).
 * That second case is rarer in practice but real: it happens when a
 * selection edge lands exactly on an element boundary rather than mid-text.
 */
function boundaryToOffset(runs: TextRun[], container: Node, offset: number): number | null {
  if (isTextNode(container)) {
    const run = runs.find((r) => r.node === container);
    return run ? run.start + offset : null;
  }

  const children = Array.from(container.childNodes);
  if (offset < children.length) {
    const child = children[offset];
    const run = runs.find((r) => child === r.node || child.contains(r.node));
    if (run) return run.start;
  }
  if (offset > 0) {
    const prevChild = children[offset - 1];
    const run = [...runs].reverse().find((r) => prevChild === r.node || prevChild.contains(r.node));
    if (run) return run.end;
  }
  return null;
}

/**
 * Returns null for a collapsed selection (nothing to highlight) or a
 * range this paragraph's text runs can't resolve at all.
 */
export function resolveSelectionOffsets(
  root: Element,
  range: RangeLike,
): { start: number; end: number } | null {
  const runs = collectTextRuns(root);
  if (runs.length === 0) return null;

  const start = boundaryToOffset(runs, range.startContainer, range.startOffset);
  const end = boundaryToOffset(runs, range.endContainer, range.endOffset);
  if (start === null || end === null || start === end) return null;

  return { start: Math.min(start, end), end: Math.max(start, end) };
}
