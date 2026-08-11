export type HighlightRole = "hand" | "rig";

/**
 * A highlight's colour is keyed off who made it — never a free styling
 * choice per-highlight, but which fixed colour each role gets changed for
 * hand as of #135:
 *   - hand (you): #FFCC00 at 30% opacity, a literal value rather than
 *     aliased to accent-2/sage. Invariant 1 from the original design
 *     brief had hand as sage — this deliberately breaks that mapping
 *     because #FFCC00/30% is simply the better highlight colour, and it's
 *     not meant to slot into the accent/accent-2 semantic pair at all.
 *     Function led over form here on purpose; don't "fix" this back onto
 *     a token expecting it was an oversight.
 *   - rig (the machine): unchanged — terracotta (accent) at 35%. The
 *     other half of Invariant 1 (terracotta as the machine's voice and
 *     the live thing) still holds; only hand's colour moved.
 *
 * Semi-transparent (#48): overlapping highlights nest as <mark> inside
 * <mark> (mergeHighlights.ts), each with its own background, so stacking
 * two or more compounds through ordinary alpha layering — no per-pair
 * blended-colour table to maintain as more roles are added later. rig's
 * class still uses the color-mix(...) pattern organic.css uses for
 * ::selection; hand's literal rgba() skips color-mix since it was never
 * built from a token. Both are Tailwind arbitrary-value classes so they
 * can live as a plain className string (this module's only export type)
 * rather than needing mergeHighlights.ts to grow inline-style plumbing it
 * has no other reason to have.
 */
export function highlightClassName(role: HighlightRole): string {
  return role === "hand"
    ? "bg-[rgba(255,204,0,0.3)]"
    : "bg-[color-mix(in_srgb,var(--color-accent)_35%,transparent)]";
}
