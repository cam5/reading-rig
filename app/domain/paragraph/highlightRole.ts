export type HighlightRole = "hand" | "rig";

/**
 * Invariant 1 from the design brief: terracotta is the machine's voice and
 * the live thing; sage is your hand and your shelf. A highlight's colour
 * is never a free styling choice — it's this mapping, always.
 *
 * Semi-transparent (#48): overlapping highlights nest as <mark> inside
 * <mark> (mergeHighlights.ts), each with its own background, so stacking
 * two or more compounds through ordinary alpha layering — no per-pair
 * blended-colour table to maintain as more roles are added later. Same
 * color-mix(...) pattern organic.css already uses for ::selection, just
 * expressed as a Tailwind arbitrary-value class so it can live as a plain
 * className string (this module's only export type) rather than needing
 * mergeHighlights.ts to grow inline-style plumbing it has no other reason
 * to have.
 */
export function highlightClassName(role: HighlightRole): string {
  return role === "hand"
    ? "bg-[color-mix(in_srgb,var(--color-accent-2)_35%,transparent)]"
    : "bg-[color-mix(in_srgb,var(--color-accent)_35%,transparent)]";
}
