import { formatLocator, formatLocatorRange } from "../locator";
import type { OrdinalRange } from "../reading/scrollPosition";

/** Marginalia's scope (#55): whatever's anchored inside `range`.
 * `null` only if the work has no paragraphs at all — nothing to scope to,
 * so nothing is excluded either. */
function isWithinMarginalia(
  range: OrdinalRange | null,
  globalOrdinal: number,
): boolean {
  return (
    range === null ||
    (globalOrdinal >= range.minGlobalOrdinal &&
      globalOrdinal <= range.maxGlobalOrdinal)
  );
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
 * The "Your hand" entries shown in the marginalia sidebar, scoped to
 * `marginaliaOrdinalRange` (#55, phase 4 of #51) — the whole work's
 * entries are loaded up front, but marginalia only ever shows whichever of
 * them anchor inside the currently-virtualized window (or the landing
 * section, before the first scroll settle — see read.tsx's
 * `initialSectionOrdinalRange`).
 */
export function deriveEntries(
  paragraphs: EntrySourceParagraph[],
  marginaliaOrdinalRange: OrdinalRange | null,
): DisplayEntry[] {
  return paragraphs
    .filter((paragraph) =>
      isWithinMarginalia(marginaliaOrdinalRange, paragraph.globalOrdinal),
    )
    .flatMap((paragraph) =>
      paragraph.entries.map((entry) => ({
        id: entry.id,
        body: entry.body,
        highlightId: entry.highlightId,
        locator: formatLocator({
          sectionLabel: String(paragraph.section.ordinal),
          paragraphOrdinal: paragraph.ordinal,
        }),
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
  highlightSpans: Array<{
    highlightId: string;
    startOffset: number;
    endOffset: number;
  }>;
};

export type DisplayHighlight = {
  id: string;
  locator: string;
  text: string;
  anchorParagraphId: string;
  /** Set only by `pendingHighlightToDisplay` — `id` is a client tempId,
   * not yet a real Highlight the server knows about, so MarginaliaSidebar
   * hides the "Write a note" composer that would otherwise submit a
   * `highlightId` the action can't find. Absent (not `false`) on every
   * highlight `deriveHighlights` produces. */
  pending?: boolean;
};

// A highlight/entry the reader just made, shown before the server has
// confirmed it — useOptimisticAnnotations' own shape for "a save is in
// flight". Spans/body are exactly what the save is submitting, not a
// server record, so there's no id/createdAt of the real kind yet — just a
// client-generated tempId good enough to key a list item and to later
// find and drop this once the real one lands.
export type PendingHighlight = {
  tempId: string;
  spans: { paragraphId: string; start: number; end: number }[];
};

export type PendingEntry = {
  tempId: string;
  anchorParagraphId: string;
  highlightId: string | null;
  body: string;
  excerpt: string;
};

type ParagraphLocator = { ordinal: number; section: { ordinal: number } };

/**
 * `pendingHighlightToDisplay`/`pendingEntryToDisplay`'s shared reach into
 * "what read.tsx already knows about this paragraph without a fetch" —
 * the same ordinal/section fields `deriveEntries`/`deriveHighlights` get
 * from a loaded paragraph row, just looked up by id instead of iterated,
 * since a pending item only ever touches the handful of paragraphs its
 * own spans/anchor name.
 */
type LocatorLookup = (paragraphId: string) => ParagraphLocator | undefined;

/**
 * The sidebar's own shape for a highlight that hasn't been confirmed by
 * the server yet — same locator/text math `deriveHighlights` uses, driven
 * off the client's already-known spans and paragraph text instead of a
 * HighlightSpan row, so it can render the instant "Highlight" (or "Write
 * a note") is clicked rather than waiting on a round trip. Superseded by
 * the real DisplayHighlight once useContentWindow's refetch lands and the
 * pending one is dropped (read.tsx's handleAnnotationSaved).
 */
export function pendingHighlightToDisplay(
  pending: PendingHighlight,
  textByParagraphId: Record<string, string>,
  locatorFor: LocatorLookup,
): DisplayHighlight {
  const first = pending.spans[0];
  const last = pending.spans[pending.spans.length - 1];
  const firstLocator = locatorFor(first.paragraphId);
  const lastLocator = locatorFor(last.paragraphId);
  const locator =
    firstLocator && lastLocator
      ? formatLocatorRange(
          {
            sectionLabel: String(firstLocator.section.ordinal),
            paragraphOrdinal: firstLocator.ordinal,
          },
          {
            sectionLabel: String(lastLocator.section.ordinal),
            paragraphOrdinal: lastLocator.ordinal,
          },
        )
      : "";
  const text = pending.spans
    .map((s) => (textByParagraphId[s.paragraphId] ?? "").slice(s.start, s.end))
    .join(" ");
  return {
    id: pending.tempId,
    locator,
    text,
    anchorParagraphId: first.paragraphId,
    pending: true,
  };
}

/** Same idea as `pendingHighlightToDisplay`, for a note. */
export function pendingEntryToDisplay(
  pending: PendingEntry,
  locatorFor: LocatorLookup,
): DisplayEntry {
  const locator = locatorFor(pending.anchorParagraphId);
  return {
    id: pending.tempId,
    body: pending.body,
    highlightId: pending.highlightId,
    locator: locator
      ? formatLocator({
          sectionLabel: String(locator.section.ordinal),
          paragraphOrdinal: locator.ordinal,
        })
      : "",
    excerpt: pending.excerpt || undefined,
  };
}

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
 * marginalia) so a highlight that straddles marginalia's boundary still
 * renders its full text, not a truncated slice of it. A highlight makes
 * marginalia if *any* part of it anchors inside `marginaliaOrdinalRange`
 * — the same "reaches the window" rule.
 */
export function deriveHighlights(
  paragraphs: HighlightSourceParagraph[],
  marginaliaOrdinalRange: OrdinalRange | null,
): DisplayHighlight[] {
  const groups = new Map<
    string,
    {
      paragraphId: string;
      globalOrdinal: number;
      sectionOrdinal: number;
      paragraphOrdinal: number;
      text: string;
    }[]
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
    .filter(([, parts]) =>
      parts.some((part) =>
        isWithinMarginalia(marginaliaOrdinalRange, part.globalOrdinal),
      ),
    )
    .map(([id, parts]) => {
      const first = parts[0];
      const last = parts[parts.length - 1];
      // formatLocatorRange already collapses to a single formatLocator
      // when both ends land in the same section and paragraph — no need
      // for this call site to also branch on that itself.
      const locator = formatLocatorRange(
        {
          sectionLabel: String(first.sectionOrdinal),
          paragraphOrdinal: first.paragraphOrdinal,
        },
        {
          sectionLabel: String(last.sectionOrdinal),
          paragraphOrdinal: last.paragraphOrdinal,
        },
      );
      // A note about this highlight anchors to its first paragraph — the
      // same "coarser than Highlight, on purpose" rule Entry always
      // follows (see the model comment in schema.prisma).
      return {
        id,
        locator,
        text: parts.map((p) => p.text).join(" "),
        anchorParagraphId: first.paragraphId,
      };
    });
}
