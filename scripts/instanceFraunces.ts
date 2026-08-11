import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import subsetFont from "subset-font";

// Fraunces (the reading voice) only ever renders at one fixed point in its
// variable design space — wght 340, "opsz" 18, "SOFT" 60, "WONK" 0, the
// recipe organic.css's `.font-reading` rule applies everywhere it's used
// (see that file's comment). Shipping @fontsource-variable/fraunces's full
// interpolatable range (all of wght 100-900 crossed with opsz/SOFT/WONK)
// pays for a whole design space the app never actually uses — instancing
// it down to that one point via subset-font's `variationAxes` (the same
// harfbuzz-subset machinery subsetCaprasimo.ts uses for glyph subsetting)
// cuts the two source files from ~121KB/~105KB to ~18KB/~15KB, an ~85%
// reduction, without changing a single rendered pixel: this produces a
// static instance at exactly the point the CSS already pins it to.
//
// Unlike Caprasimo, this can't also glyph-subset down to a closed string
// set — Fraunces renders arbitrary ingested book text (see ReadingParagraph)
// — so the output keeps every glyph latin + latin-ext already covers. The
// two unicode-range lists below are copied verbatim from fonts.css's own
// @font-face rules for this font; if those ranges ever change, update both
// (same duplication fonts.css already accepts for Figtree's per-weight
// ranges — there's no single source of truth for this today).

const SOURCE_DIR = path.join(import.meta.dirname, "../node_modules/@fontsource-variable/fraunces/files");
const OUTPUT_DIR = path.join(import.meta.dirname, "../public/fonts/generated");

const VARIATION_AXES = { wght: 340, opsz: 18, SOFT: 60, WONK: 0 };

// [start, end] codepoint pairs — a bare codepoint is [cp, cp].
const LATIN_RANGES: [number, number][] = [
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

const LATIN_EXT_RANGES: [number, number][] = [
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

function rangesToText(ranges: [number, number][]): string {
  let text = "";
  for (const [start, end] of ranges) {
    for (let cp = start; cp <= end; cp++) text += String.fromCodePoint(cp);
  }
  return text;
}

async function instance(sourceFile: string, outputFile: string, ranges: [number, number][]) {
  const sourceBuffer = await readFile(path.join(SOURCE_DIR, sourceFile));
  const text = rangesToText(ranges);
  const outBuffer = await subsetFont(sourceBuffer, text, {
    targetFormat: "woff2",
    variationAxes: VARIATION_AXES,
  });
  await writeFile(path.join(OUTPUT_DIR, outputFile), outBuffer);
  console.log(
    `[instanceFraunces] ${sourceFile} -> ${outputFile}: ${sourceBuffer.length} -> ${outBuffer.length} bytes ` +
      `(${Math.round((1 - outBuffer.length / sourceBuffer.length) * 100)}% smaller)`,
  );
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await instance("fraunces-latin-full-normal.woff2", "fraunces-latin-instance.woff2", LATIN_RANGES);
  await instance("fraunces-latin-ext-full-normal.woff2", "fraunces-latin-ext-instance.woff2", LATIN_EXT_RANGES);
}

main().catch((error) => {
  console.error("[instanceFraunces] failed:", error);
  process.exit(1);
});
