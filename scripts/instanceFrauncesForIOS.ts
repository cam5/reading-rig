import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import subsetFont from "subset-font";
import {
  SOURCE_DIR,
  VARIATION_AXES,
  LATIN_RANGES,
  rangesToText,
} from "./lib/frauncesInstancing";

/**
 * ios/README.md's own "no bundled Fraunces typeface" gap, closed — same
 * source package and pinned variable-axis point instanceFraunces.ts
 * already uses for the web, output as `sfnt` (a real .ttf CoreText can
 * load) instead of `woff2`, into ios/'s SwiftPM resource folder instead
 * of public/fonts/generated.
 *
 * Latin range only, not latin-ext — instanceFraunces.ts subsets the
 * "latin" and "latin-ext" *source files* separately because they're
 * genuinely disjoint scripts-worth of glyphs on disk (fontsource's
 * per-script split), which works for the web because two @font-face
 * rules with different unicode-range hints can coexist. Two separately
 * registered CoreText fonts sharing the same PostScript name (which
 * these would, since harfbuzz-subset preserves the source's name table
 * verbatim) risk one silently shadowing the other's glyph coverage
 * instead of falling back — untested and not worth the risk for the
 * rarer Latin Extended-A diacritics latin-ext covers. Latin-1 (the
 * `[0x0000,0x00ff]` range below) already covers ordinary European-language
 * book text; a genuinely rare glyph outside that range falls back to
 * whatever font macOS/iOS picks next, not a crash.
 */
const OUTPUT_DIR = path.join(
  import.meta.dirname,
  "../ios/Sources/ReadingRigUI/Resources",
);

async function instance(sourceFile: string, outputFile: string) {
  const sourceBuffer = await readFile(path.join(SOURCE_DIR, sourceFile));
  const text = rangesToText(LATIN_RANGES);
  const outBuffer = await subsetFont(sourceBuffer, text, {
    targetFormat: "sfnt",
    variationAxes: VARIATION_AXES,
  });
  await writeFile(path.join(OUTPUT_DIR, outputFile), outBuffer);
  console.log(
    `[instanceFrauncesForIOS] ${sourceFile} -> ${outputFile}: ${sourceBuffer.length} -> ${outBuffer.length} bytes`,
  );
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await instance(
    "fraunces-latin-full-normal.woff2",
    "Fraunces-Reading-Regular.ttf",
  );
  await instance(
    "fraunces-latin-full-italic.woff2",
    "Fraunces-Reading-Italic.ttf",
  );
}

main().catch((error) => {
  console.error("[instanceFrauncesForIOS] failed:", error);
  process.exit(1);
});
