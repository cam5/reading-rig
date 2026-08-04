// Every string that is ever set in Baloo 2 (the display face) — a small,
// genuinely closed set of UI chrome, never ingested/dynamic content. This is
// the single source of truth for DisplayText's compile-time constraint (see
// ../../components/DisplayText.tsx): a string added here is the only thing
// that can ever widen what renders in the display face.
//
// The error boundary's <h1>{message}</h1> ("Oops!"/"404"/"Error") is
// deliberately exempted from Baloo 2 instead of folded in here — see the
// comment at its call site in root.tsx.
export const DISPLAY_STRINGS = [
  "Reading Rig",
  "Marginalia",
  "Write a note",
  "Cancel",
  "Save",
  "Highlight",
  "←",
  "→",
] as const;

export type DisplayString = (typeof DISPLAY_STRINGS)[number];
