import type { OrdinalRange } from "~/domain/reading/scrollPosition";

export type RigWorkMeta = { title: string; author: string | null };

/** Every loaded paragraph's text within `range`, in ordinal order, joined
 * as one excerpt — read.tsx's own on-screen span (mounted/virtualized, not
 * pixel-exact viewport; the same scope marginalia already uses), for the
 * header's "Ask the Rig" launch, which has no selection to excerpt from
 * instead. `null` range (nothing settled yet) or no paragraphs found both
 * fall back to "", not every paragraph in the work. */
export function formatOnScreenExcerpt(
  paragraphs: { globalOrdinal: number; text: string }[],
  range: OrdinalRange | null,
): string {
  if (!range) return "";
  return paragraphs
    .filter((p) => p.globalOrdinal >= range.minGlobalOrdinal && p.globalOrdinal <= range.maxGlobalOrdinal)
    .sort((a, b) => a.globalOrdinal - b.globalOrdinal)
    .map((p) => p.text)
    .join("\n\n");
}

/**
 * Plain-text framing sent once, at the top of whatever the reader actually
 * asks, telling the Rig what work this is and what excerpt prompted the
 * question — a highlighted selection, or (opened from the header, with
 * nothing selected) whatever's currently on screen. Not sent on every
 * message: RigLivePanel prepends this to the first `send()` after each
 * open, not to the session's history as a whole, since "on screen" is only
 * ever accurate for the moment the panel was opened.
 */
export function buildRigLaunchContext(work: RigWorkMeta, excerpt: string): string {
  const byline = work.author ? ` by ${work.author}` : "";
  return `[Reading "${work.title}"${byline}. Currently on screen:\n\n${excerpt}]`;
}
