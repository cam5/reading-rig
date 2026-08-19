import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import subsetFont from "subset-font";
import {
  SOURCE_DIR,
  VARIATION_AXES,
  LATIN_RANGES,
  LATIN_EXT_RANGES,
  rangesToText,
} from "./lib/frauncesInstancing";

// Fraunces (the reading voice) only ever renders at one fixed point in its
// variable design space — see scripts/lib/frauncesInstancing.ts for the
// pinned point and why. Shipping @fontsource-variable/fraunces's full
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
// — so the output keeps every glyph latin + latin-ext already covers.

const OUTPUT_DIR = path.join(import.meta.dirname, "../public/fonts/generated");

async function instance(
  sourceFile: string,
  outputFile: string,
  ranges: [number, number][],
) {
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
  await instance(
    "fraunces-latin-full-normal.woff2",
    "fraunces-latin-instance.woff2",
    LATIN_RANGES,
  );
  await instance(
    "fraunces-latin-ext-full-normal.woff2",
    "fraunces-latin-ext-instance.woff2",
    LATIN_EXT_RANGES,
  );
}

main().catch((error) => {
  console.error("[instanceFraunces] failed:", error);
  process.exit(1);
});
