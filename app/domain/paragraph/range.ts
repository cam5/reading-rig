/** A half-open `[start, end)` range. Two ranges that merely touch — one's
 * `end` equals the other's `start` — don't overlap. */
export type Range = { start: number; end: number };

/**
 * True if `a` and `b` overlap under the half-open `[start, end)` convention
 * used throughout this module (see highlightOverlap.ts and
 * mergeHighlights.ts, both of which check this on the same character
 * offsets for different reasons — one before a highlight is persisted, the
 * other before it's rendered).
 */
export function rangesOverlap(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}
