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
