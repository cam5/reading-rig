// Every string that is ever set in Caprasimo (the display face) — a small,
// genuinely closed set of UI chrome, never ingested/dynamic content. This is
// the single source of truth for both DisplayText's compile-time constraint
// (see ../../components/DisplayText.tsx) and scripts/subsetCaprasimo.ts's
// glyph subsetting: the subset script imports this array directly rather
// than hand-duplicating a character list, so a string added here is the
// only thing that can ever widen what Caprasimo needs to render.
//
// The error boundary's <h1>{message}</h1> ("Oops!"/"404"/"Error") is
// deliberately exempted from Caprasimo instead of folded in here — see the
// comment at its call site in root.tsx.
export const DISPLAY_STRINGS = [
  "Reading Rig",
  "Write a note",
  "Cancel",
  "Save",
  "Ask the Rig",
  "Close",
  "←",
  "→",
  "↑",
  "↓",
] as const;

export type DisplayString = (typeof DISPLAY_STRINGS)[number];
