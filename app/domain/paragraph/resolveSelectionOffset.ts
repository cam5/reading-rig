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
function boundaryToOffset(
  runs: TextRun[],
  container: Node,
  offset: number,
): number | null {
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
    const run = [...runs]
      .reverse()
      .find((r) => prevChild === r.node || prevChild.contains(r.node));
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

export type ElementSpan = { element: Element; start: number; end: number };

/**
 * The multi-paragraph counterpart to resolveSelectionOffsets: resolves one
 * span per paragraph a selection touches, rather than assuming it's
 * confined to a single one. `paragraphElements` must be in document order
 * and cover every paragraph the selection reaches, from first to last —
 * SelectionHighlighter builds this list by slicing the rendered paragraphs
 * between wherever `range.startContainer` and `range.endContainer` each
 * land. Returns `element`, not a `paragraphId`: this module stays agnostic
 * of the `data-paragraph-id` convention, same as resolveSelectionOffsets
 * — reading that attribute off each element is SelectionHighlighter's job.
 *
 * Only the first and last element in that list can be partially covered
 * (the selection starts or ends mid-text there); anything strictly
 * between them is a paragraph the selection passes all the way through,
 * so it's [0, full length) — not resolved from the range at all.
 *
 * A backward drag (the visually later paragraph holds
 * `range.startContainer`) is handled the same way resolveSelectionOffsets
 * handles a backward drag within one paragraph: try to resolve each
 * boundary against whichever end of `paragraphElements` it actually
 * belongs to, rather than assuming start-before-end.
 *
 * A resolved edge can still turn out empty — a triple click's
 * `endContainer` landing at offset 0 of the *following* paragraph (a real
 * browser quirk, not a user selecting into it), or a drag that starts
 * exactly at a paragraph's end. Either way nothing there was actually
 * selected, so empty leading/trailing spans are trimmed from the result
 * rather than treated as the selection reaching that paragraph.
 *
 * Returns null under the same conditions as resolveSelectionOffsets: a
 * collapsed selection, or a boundary neither end of the list can resolve.
 */
export function resolveSelectionSpans(
  paragraphElements: Element[],
  range: RangeLike,
): ElementSpan[] | null {
  if (paragraphElements.length === 0) return null;

  if (paragraphElements.length === 1) {
    const offsets = resolveSelectionOffsets(paragraphElements[0], range);
    return offsets ? [{ element: paragraphElements[0], ...offsets }] : null;
  }

  const first = paragraphElements[0];
  const last = paragraphElements[paragraphElements.length - 1];

  // Each boundary point belongs to whichever of `first`/`last` actually
  // contains its container — not necessarily `first` === start,
  // `last` === end, since a drag can run either direction.
  const firstBoundary = first.contains(range.startContainer)
    ? { container: range.startContainer, offset: range.startOffset }
    : first.contains(range.endContainer)
      ? { container: range.endContainer, offset: range.endOffset }
      : null;
  const lastBoundary = last.contains(range.startContainer)
    ? { container: range.startContainer, offset: range.startOffset }
    : last.contains(range.endContainer)
      ? { container: range.endContainer, offset: range.endOffset }
      : null;
  if (!firstBoundary || !lastBoundary) return null;

  const firstRuns = collectTextRuns(first);
  const lastRuns = collectTextRuns(last);
  if (firstRuns.length === 0 || lastRuns.length === 0) return null;

  const firstOffset = boundaryToOffset(
    firstRuns,
    firstBoundary.container,
    firstBoundary.offset,
  );
  const lastOffset = boundaryToOffset(
    lastRuns,
    lastBoundary.container,
    lastBoundary.offset,
  );
  if (firstOffset === null || lastOffset === null) return null;

  const firstLength = firstRuns[firstRuns.length - 1].end;

  const spans: ElementSpan[] = paragraphElements.map((element) => {
    if (element === first)
      return { element, start: firstOffset, end: firstLength };
    if (element === last) return { element, start: 0, end: lastOffset };
    const runs = collectTextRuns(element);
    const length = runs.length > 0 ? runs[runs.length - 1].end : 0;
    return { element, start: 0, end: length };
  });

  let lo = 0;
  let hi = spans.length - 1;
  while (lo < hi && spans[lo].start === spans[lo].end) lo++;
  while (hi > lo && spans[hi].start === spans[hi].end) hi--;
  const trimmed = spans.slice(lo, hi + 1);

  if (trimmed.every((s) => s.start === s.end)) return null;
  return trimmed;
}
