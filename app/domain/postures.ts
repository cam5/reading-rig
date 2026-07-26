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
