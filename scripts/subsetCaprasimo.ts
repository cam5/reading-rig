import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import subsetFont from "subset-font";
import { DISPLAY_STRINGS } from "../app/domain/typography/displayStrings";

// Caprasimo is only ever used for the closed set of chrome strings in
// DISPLAY_STRINGS (see that file's own comment) — never ingested/dynamic
// content — so it's the one of the three self-hosted families worth
// glyph-subsetting down to exactly what's used, rather than just Latin +
// Latin-Extended like Figtree/Newsreader.
//
// The source file is a one-time, human-auditable asset committed under
// assets/fonts/source/ (see the README there for provenance) — not
// fetched here. This script only reads it and re-derives the subset, so
// there's no way for a checked-in subset to drift stale when
// DISPLAY_STRINGS changes: the output below is gitignored and always
// regenerated fresh by `predev`/`prebuild`.

const SOURCE_FONT = path.join(import.meta.dirname, "../assets/fonts/source/Caprasimo-Regular.ttf");
const OUTPUT_DIR = path.join(import.meta.dirname, "../public/fonts/generated");
const OUTPUT_FONT = path.join(OUTPUT_DIR, "caprasimo-subset.woff2");

async function main() {
  const sourceBuffer = await readFile(SOURCE_FONT);

  // The deduped codepoints across all 8 strings — logged so a glance at
  // build output shows exactly what Caprasimo is being subsetted to.
  const text = DISPLAY_STRINGS.join("");
  const codepoints = [...new Set([...text].map((char) => char.codePointAt(0)!))].sort((a, b) => a - b);
  console.log(
    `[subsetCaprasimo] subsetting to ${codepoints.length} codepoints from ${DISPLAY_STRINGS.length} strings: ` +
      codepoints.map((cp) => `U+${cp.toString(16).toUpperCase()}`).join(" "),
  );

  const subsetBuffer = await subsetFont(sourceBuffer, text, { targetFormat: "woff2" });

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_FONT, subsetBuffer);
  console.log(`[subsetCaprasimo] wrote ${OUTPUT_FONT} (${subsetBuffer.length} bytes)`);
}

main().catch((error) => {
  console.error("[subsetCaprasimo] failed:", error);
  process.exit(1);
});
