export type HighlightRole = "hand" | "rig";

/**
 * Invariant 1 from the design brief: terracotta is the machine's voice and
 * the live thing; sage is your hand and your shelf. A highlight's colour
 * is never a free styling choice — it's this mapping, always.
 */
export function highlightClassName(role: HighlightRole): string {
  return role === "hand" ? "bg-accent-2-200" : "bg-accent-200";
}
