import fraunceLatinFullWoff2 from "@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2?url";

/**
 * Fraunces preload link, for the routes that actually render `.font-reading`
 * content — read.tsx, commonplace.tsx, commonplace.$entryId.tsx — rather
 * than root.tsx's global `links` (unlike Figtree, which every route's
 * interface chrome needs). Fraunces's one variable-axis file is ~121KB,
 * versus Literata's ~15KB static latin-400 cut it replaced (#135); global
 * preloading pushed `/`'s Lighthouse font budget from comfortably under to
 * 133.8KB against a 64KB budget, even though `/` never renders a word of
 * reading-voice text. Scoping the preload to the routes that use it fixes
 * that without shrinking the font itself — `/` simply never fetches it.
 */
export const fraunceLinks = [
  { rel: "preload", as: "font", type: "font/woff2", href: fraunceLatinFullWoff2, crossOrigin: "anonymous" } as const,
];
