import { formatLocator, formatLocatorRange } from "../locator";
import type { OrdinalRange } from "../reading/scrollPosition";

/** The margin rail's scope (#55): whatever's anchored inside `range`.
 * `null` only if the work has no paragraphs at all — nothing to scope to,
 * so nothing is excluded either. */
function isWithinMarginRail(range: OrdinalRange | null, globalOrdinal: number): boolean {
  return range === null || (globalOrdinal >= range.minGlobalOrdinal && globalOrdinal <= range.maxGlobalOrdinal);
}

type EntrySourceParagraph = {
  ordinal: number;
  globalOrdinal: number;
  section: { ordinal: number };
  entries: Array<{
    id: string;
    body: string;
    highlightId: string | null;
    contextSnapshot: unknown;
  }>;
};

export type DisplayEntry = {
  id: string;
  body: string;
  highlightId: string | null;
  locator: string;
  excerpt?: string;
};

/**
 * The "Your hand" entries shown in the "Today's page" sidebar, scoped to
 * `marginRailOrdinalRange` (#55, phase 4 of #51) — the whole work's
 * entries are loaded up front, but the rail only ever shows whichever of
 * them anchor inside the currently-virtualized window (or the landing
 * section, before the first scroll settle — see read.tsx's
 * `initialSectionOrdinalRange`).
 */
export function deriveEntries(
  paragraphs: EntrySourceParagraph[],
  marginRailOrdinalRange: OrdinalRange | null,
): DisplayEntry[] {
  return paragraphs
    .filter((paragraph) => isWithinMarginRail(marginRailOrdinalRange, paragraph.globalOrdinal))
    .flatMap((paragraph) =>
      paragraph.entries.map((entry) => ({
        id: entry.id,
        body: entry.body,
        highlightId: entry.highlightId,
        locator: formatLocator({ sectionLabel: String(paragraph.section.ordinal), paragraphOrdinal: paragraph.ordinal }),
        excerpt:
          entry.contextSnapshot && typeof entry.contextSnapshot === "object"
            ? (entry.contextSnapshot as { excerpt?: string }).excerpt
            : undefined,
      })),
    );
}

type HighlightSourceParagraph = {
  id: string;
  ordinal: number;
  globalOrdinal: number;
  text: string;
  section: { ordinal: number };
  highlightSpans: Array<{ highlightId: string; startOffset: number; endOffset: number }>;
};

export type DisplayHighlight = {
  id: string;
  locator: string;
  text: string;
  anchorParagraphId: string;
};

/**
 * One list item per Highlight, not per HighlightSpan: a spanning highlight
 * touches several paragraphs but is one thing the user made. `paragraphs`
 * must already be ordinal-ordered (the loader's own orderBy) — appending
 * each span's text as we walk paragraphs in order reconstructs the
 * highlight's full text without a separate sort here. A highlight can
 * reach across a section (even a chapter) boundary — each part carries
 * its own section ordinal rather than assuming one shared section for the
 * whole highlight.
 *
 * Groups are built from every paragraph in the work (not pre-scoped to
 * the margin rail) so a highlight that straddles the rail's boundary
 * still renders its full text, not a truncated slice of it. A highlight
 * makes the rail if *any* part of it anchors inside
 * `marginRailOrdinalRange` — the same "reaches the window" rule.
 */
export function deriveHighlights(
  paragraphs: HighlightSourceParagraph[],
  marginRailOrdinalRange: OrdinalRange | null,
): DisplayHighlight[] {
  const groups = new Map<
    string,
    { paragraphId: string; globalOrdinal: number; sectionOrdinal: number; paragraphOrdinal: number; text: string }[]
  >();
  for (const paragraph of paragraphs) {
    for (const span of paragraph.highlightSpans) {
      const parts = groups.get(span.highlightId) ?? [];
      parts.push({
        paragraphId: paragraph.id,
        globalOrdinal: paragraph.globalOrdinal,
        sectionOrdinal: paragraph.section.ordinal,
        paragraphOrdinal: paragraph.ordinal,
        text: paragraph.text.slice(span.startOffset, span.endOffset),
      });
      groups.set(span.highlightId, parts);
    }
  }

  return Array.from(groups.entries())
    .filter(([, parts]) => parts.some((part) => isWithinMarginRail(marginRailOrdinalRange, part.globalOrdinal)))
    .map(([id, parts]) => {
      const first = parts[0];
      const last = parts[parts.length - 1];
      // formatLocatorRange already collapses to a single formatLocator
      // when both ends land in the same section and paragraph — no need
      // for this call site to also branch on that itself.
      const locator = formatLocatorRange(
        { sectionLabel: String(first.sectionOrdinal), paragraphOrdinal: first.paragraphOrdinal },
        { sectionLabel: String(last.sectionOrdinal), paragraphOrdinal: last.paragraphOrdinal },
      );
      // A note about this highlight anchors to its first paragraph — the
      // same "coarser than Highlight, on purpose" rule Entry always
      // follows (see the model comment in schema.prisma).
      return { id, locator, text: parts.map((p) => p.text).join(" "), anchorParagraphId: first.paragraphId };
    });
}
