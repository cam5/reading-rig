/**
 * Posture enum values are lowerCamelCase (schema convention); this is the
 * one place they map back to the display labels the design uses. Shared
 * between the reader's "Today's page" pane (read.tsx) and the commonplace
 * book (commonplace.tsx) — both render an Entry's posture kicker off the
 * same Posture enum, so the mapping belongs here rather than duplicated
 * in each route.
 */
export const POSTURE_LABELS: Record<string, string> = {
  interrogate: "Interrogate",
  steelman: "Steelman",
  connect: "Connect",
  closeRead: "Close-read",
  context: "Context",
  recap: "Recap",
};

/**
 * The six posture ids, in the design's own order (lens rail, slash
 * palette, system prompt). The one place this order is declared —
 * agentConfig.ts's system prompt and read.tsx's lens rail both import it,
 * rather than each keeping their own copy that could drift apart.
 */
export const POSTURE_ORDER = ["interrogate", "steelman", "connect", "closeRead", "context", "recap"] as const;

export type PostureId = (typeof POSTURE_ORDER)[number];

/**
 * Short, quiet descriptions for the slash palette (#28's `#2b`) — one
 * clause each, paraphrased from agentConfig.ts's own posture framings
 * rather than invented fresh, so the palette's language and the system
 * prompt's never drift apart. Deliberately noun-phrase-short (matching the
 * design mock's own "press the claim" / "4 passages in your shelf touch
 * this" register) rather than full sentences — the build plan's copy
 * invariant (quiet, literary, no exclamation, no product cheer) applies
 * here same as everywhere else.
 */
export const POSTURE_DESCRIPTIONS: Record<PostureId, string> = {
  interrogate: "press the claim",
  steelman: "the strongest case for it, argued in full",
  connect: "a line out to the rest of the shelf",
  closeRead: "diction, syntax, the shape of the sentence",
  context: "what the word carried in the year it was written",
  recap: "where you stand, plainly restated",
};

/**
 * Ranks (and, once a query is typed, filters) the six postures for the
 * slash palette. An empty query returns POSTURE_ORDER as-is — the "fixed
 * sensible default" the design's own doc comment above already names as
 * the one true order (lens rail, slash palette, system prompt all read off
 * it). A non-empty query is matched case-insensitively against each
 * posture's label, ranked prefix match before mid-label match before a
 * match only on the internal id (so e.g. "read" still finds "Close-read"
 * ranked below anything that starts with "read"), ties broken by
 * POSTURE_ORDER position; a posture that matches nothing is dropped
 * rather than shown out of place, which is the more standard command-
 * palette convention and the one the design mock's own illustrative
 * "clos" example doesn't unambiguously rule out.
 */
export function rankPostures(query: string): PostureId[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...POSTURE_ORDER];

  const scored: { id: PostureId; score: number; index: number }[] = [];
  POSTURE_ORDER.forEach((id, index) => {
    const label = POSTURE_LABELS[id].toLowerCase();
    let score: number | null = null;
    if (label.startsWith(needle)) score = 0;
    else if (label.includes(needle)) score = 1;
    else if (id.toLowerCase().includes(needle)) score = 2;
    if (score !== null) scored.push({ id, score, index });
  });

  scored.sort((a, b) => (a.score !== b.score ? a.score - b.score : a.index - b.index));
  return scored.map((s) => s.id);
}

/**
 * Roving-tabindex/radiogroup arrow-key math for the lens rail (#27): given
 * the currently-held posture's index and a KeyboardEvent.key, returns the
 * index arrow navigation moves to, or null if the key isn't one of the
 * navigation keys this widget answers to (so the caller knows to leave the
 * event alone rather than swallow, say, Tab).
 *
 * The rail is drawn as a vertical stack (writing-mode: vertical-rl labels
 * in a column), so ArrowDown/ArrowUp are the primary axis — but ArrowRight/
 * ArrowLeft are accepted too, same convention a native vertical
 * radiogroup's rotated text would still expect from a mouse-and-keyboard
 * user reading the labels top-to-bottom. Wraps at both ends (index 5 ->
 * ArrowDown -> 0) rather than stopping, matching native radio-group
 * behaviour. Home/End jump to the first/last posture.
 */
export function nextPostureIndex(currentIndex: number, key: string, length: number): number | null {
  if (length <= 0) return null;
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return (currentIndex + 1 + length) % length;
    case "ArrowUp":
    case "ArrowLeft":
      return (currentIndex - 1 + length) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return null;
  }
}

/**
 * Names the held posture at the start of the turn, per the build plan
 * ("the held posture is named in each user message") and agentConfig.ts's
 * system prompt ("The posture is stated at the start of each turn") —
 * picking a posture re-frames the same question rather than sending a
 * different agent invocation, so the framing lives here as one shared
 * function rather than being reconstructed wherever a turn gets sent.
 */
export function framePostureTurn(postureLabel: string, question: string): string {
  return `Posture: ${postureLabel}\n\n${question}`;
}
