/**
 * Fraunces preload link, for the routes that actually render `.font-reading`
 * content — read.tsx, commonplace.tsx, commonplace.$entryId.tsx — rather
 * than root.tsx's global `links` (unlike Figtree, which every route's
 * interface chrome needs). `/`'s Lighthouse font budget originally caught
 * this at ~121KB (the full variable-axis file, global-preloaded despite
 * `/` never rendering a word of reading-voice text) — since fixed twice
 * over: scoping the preload here so `/` never fetches it at all, and
 * instanceFraunces.ts (see fonts.css) shrinking the file itself by ~85%
 * for the routes that do. Not a Vite package import like Figtree's own
 * preload in root.tsx: this is a generated file (instanceFraunces.ts),
 * served at this literal path, same as Caprasimo's own preload.
 */
export const fraunceLinks = [
  {
    rel: "preload",
    as: "font",
    type: "font/woff2",
    href: "/fonts/generated/fraunces-latin-instance.woff2",
    crossOrigin: "anonymous",
  } as const,
];
