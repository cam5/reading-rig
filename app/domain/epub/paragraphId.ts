import { createHash } from "node:crypto";

/**
 * Content-addressed paragraph IDs: a hash of the work, the spine file it
 * came from, and its structural position within that file — never a
 * random ID, and never derived from the paragraph's own text.
 *
 * This is what lets a re-ingest of the same EPUB not orphan existing
 * highlights and notes: the same paragraph, ingested twice, gets the same
 * id both times, because the hash's inputs (which spine file, which
 * section, which paragraph within it) don't change even though the
 * ingest process runs again from scratch.
 *
 * Deliberately NOT a hash of the paragraph's text: editing a single
 * paragraph in the source (a typo fix) would then change that paragraph's
 * id, but a structural hash lets us tell "the text changed under a stable
 * anchor" apart from "the anchor moved" — the former is recoverable, the
 * latter is exactly what would orphan a highlight.
 */
export function computeParagraphId(
  workId: string,
  spineIndex: number,
  elementPath: string,
): string {
  const hash = createHash("sha256")
    .update(workId)
    .update("\0")
    .update(String(spineIndex))
    .update("\0")
    .update(elementPath)
    .digest("hex");
  return `p_${hash.slice(0, 24)}`;
}
