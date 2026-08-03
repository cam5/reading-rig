/**
 * Cumulative character offsets after each "word plus its trailing
 * whitespace" run in `text` — the reveal points `RigMessage` steps through
 * one at a time, so `text.slice(0, offsets[i])` is always a prefix of
 * `text` ending on a word boundary (never a slice cut off mid-word).
 */
export function wordBoundaryOffsets(text: string): number[] {
  const offsets: number[] = [];
  const wordPattern = /\S+\s*/g;
  let match: RegExpExecArray | null;
  while ((match = wordPattern.exec(text)) !== null) {
    offsets.push(match.index + match[0].length);
  }
  return offsets;
}
