import path from "node:path";

/**
 * Shared between instanceFraunces.ts (web, woff2) and
 * instanceFrauncesForIOS.ts (iOS, sfnt) — split out to a side-effect-free
 * module rather than importing one script from the other, since both of
 * those run a top-level `main()` on import with no guard against being
 * pulled in as a module.
 *
 * Fraunces (the reading voice) only ever renders at one fixed point in its
 * variable design space — wght 340, "opsz" 18, "SOFT" 60, "WONK" 0, the
 * recipe organic.css's `.font-reading` rule applies everywhere it's used
 * (see that file's comment).
 */

export const SOURCE_DIR = path.join(
  import.meta.dirname,
  "../../node_modules/@fontsource-variable/fraunces/files",
);

export const VARIATION_AXES = { wght: 340, opsz: 18, SOFT: 60, WONK: 0 };

// [start, end] codepoint pairs — a bare codepoint is [cp, cp]. Copied
// verbatim from fonts.css's own @font-face rule for this font; if that
// range ever changes, update both (same duplication fonts.css already
// accepts for Figtree's per-weight ranges — there's no single source of
// truth for this today).
export const LATIN_RANGES: [number, number][] = [
  [0x0000, 0x00ff],
  [0x0131, 0x0131],
  [0x0152, 0x0153],
  [0x02bb, 0x02bc],
  [0x02c6, 0x02c6],
  [0x02da, 0x02da],
  [0x02dc, 0x02dc],
  [0x0304, 0x0304],
  [0x0308, 0x0308],
  [0x0329, 0x0329],
  [0x2000, 0x206f],
  [0x20ac, 0x20ac],
  [0x2122, 0x2122],
  [0x2191, 0x2191],
  [0x2193, 0x2193],
  [0x2212, 0x2212],
  [0x2215, 0x2215],
  [0xfeff, 0xfeff],
  [0xfffd, 0xfffd],
];

export const LATIN_EXT_RANGES: [number, number][] = [
  [0x0100, 0x02ba],
  [0x02bd, 0x02c5],
  [0x02c7, 0x02cc],
  [0x02ce, 0x02d7],
  [0x02dd, 0x02ff],
  [0x0304, 0x0304],
  [0x0308, 0x0308],
  [0x0329, 0x0329],
  [0x1d00, 0x1dbf],
  [0x1e00, 0x1e9f],
  [0x1ef2, 0x1eff],
  [0x2020, 0x2020],
  [0x20a0, 0x20ab],
  [0x20ad, 0x20c0],
  [0x2113, 0x2113],
  [0x2c60, 0x2c7f],
  [0xa720, 0xa7ff],
];

export function rangesToText(ranges: [number, number][]): string {
  let text = "";
  for (const [start, end] of ranges) {
    for (let cp = start; cp <= end; cp++) text += String.fromCodePoint(cp);
  }
  return text;
}
