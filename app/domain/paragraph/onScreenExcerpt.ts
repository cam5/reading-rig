import { formatLocatorRange } from "../locator";
import type { OrdinalRange } from "../reading/scrollPosition";

/**
 * The composer's "in view" token (#117 follow-up): whatever's currently
 * on screen, captured as one insertable unit rather than the header
 * launch-flow's plain string (buildLaunchContext.ts's formatOnScreenExcerpt).
 * A pill needs a locator to display and a stable ordinal span to decide
 * "is one already in the composer", neither of which that flow needed.
 */
export type OnScreenExcerpt = {
  text: string;
  /** e.g. "§4 ¶2–5" — spans the whole range, not just its first paragraph. */
  locator: string;
  minGlobalOrdinal: number;
  maxGlobalOrdinal: number;
};

type ExcerptSourceParagraph = {
  ordinal: number;
  globalOrdinal: number;
  text: string;
  section: { ordinal: number };
};

/**
 * Builds the composer's "in view" candidate from the same source paragraphs
 * and range read.tsx already threads through to marginalia
 * (marginaliaSourceParagraphs / marginaliaOrdinalRange) — a deliberate fork
 * of formatOnScreenExcerpt's filter-and-join rather than a shared helper,
 * since this caller also needs the range's locator and bounds, not just its
 * text. `null` range or no paragraphs found in it both yield `null`: nothing
 * to offer as a pinned suggestion yet.
 */
export function buildOnScreenExcerpt(
  paragraphs: ExcerptSourceParagraph[],
  range: OrdinalRange | null,
): OnScreenExcerpt | null {
  if (!range) return null;
  const inRange = paragraphs
    .filter((p) => p.globalOrdinal >= range.minGlobalOrdinal && p.globalOrdinal <= range.maxGlobalOrdinal)
    .sort((a, b) => a.globalOrdinal - b.globalOrdinal);
  if (inRange.length === 0) return null;

  const first = inRange[0];
  const last = inRange[inRange.length - 1];
  return {
    text: inRange.map((p) => p.text).join("\n\n"),
    locator: formatLocatorRange(
      { sectionLabel: String(first.section.ordinal), paragraphOrdinal: first.ordinal },
      { sectionLabel: String(last.section.ordinal), paragraphOrdinal: last.ordinal },
    ),
    minGlobalOrdinal: first.globalOrdinal,
    maxGlobalOrdinal: last.globalOrdinal,
  };
}
