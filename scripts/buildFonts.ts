import { createHash } from "node:crypto";
import { readFile, writeFile, access, rm } from "node:fs/promises";
import path from "node:path";
import {
  subsetCaprasimo,
  SOURCE_FONT as CAPRASIMO_SOURCE,
  OUTPUT_FONT as CAPRASIMO_OUTPUT,
} from "./subsetCaprasimo";
import {
  instanceFraunces,
  SOURCE_FILES as FRAUNCES_SOURCES,
  OUTPUT_FILES as FRAUNCES_OUTPUTS,
} from "./instanceFraunces";
import { fontToolchainVersions } from "./lib/fontToolchain";

// The single predev/prebuild/prebuild-storybook entrypoint for the
// generated web fonts: one tsx process running both generators
// concurrently, instead of two serial ones — and skipping both entirely
// when nothing they read has changed since the last run, so a dev restart
// or CI's `test:smoke` build followed by `build-storybook` doesn't redo
// identical harfbuzz work.
//
// The skip is keyed on a sha256 over *every* input that determines the
// output bytes — the source fonts, DISPLAY_STRINGS, the pinned instancing
// config, both generator scripts (and this one), and the installed
// versions of subset-font and the libraries that do its work
// (lib/fontToolchain.ts) — so it keeps subsetCaprasimo.ts's guarantee that
// the output can't drift stale against DISPLAY_STRINGS: any edit there
// changes the hash and forces a regenerate. `--force` / FONTS_FORCE=1
// bypasses the check outright.

const OUTPUT_DIR = path.join(import.meta.dirname, "../public/fonts/generated");
const STAMP_FILE = path.join(OUTPUT_DIR, ".stamp");

const INPUT_FILES = [
  CAPRASIMO_SOURCE,
  ...FRAUNCES_SOURCES,
  path.join(import.meta.dirname, "../app/domain/typography/displayStrings.ts"),
  path.join(import.meta.dirname, "lib/frauncesInstancing.ts"),
  path.join(import.meta.dirname, "lib/fontToolchain.ts"),
  path.join(import.meta.dirname, "subsetCaprasimo.ts"),
  path.join(import.meta.dirname, "instanceFraunces.ts"),
  import.meta.filename,
];
const OUTPUT_FILES = [CAPRASIMO_OUTPUT, ...FRAUNCES_OUTPUTS];

async function inputHash() {
  const hash = createHash("sha256");
  for (const file of INPUT_FILES) {
    // The path goes in too, so moving bytes between two inputs can't
    // collide with the old layout.
    hash.update(path.relative(import.meta.dirname, file));
    hash.update(await readFile(file));
  }
  for (const version of fontToolchainVersions(import.meta.filename)) {
    hash.update(version);
  }
  return hash.digest("hex");
}

async function exists(file: string) {
  return access(file).then(
    () => true,
    () => false,
  );
}

async function main() {
  const force =
    process.argv.includes("--force") || process.env.FONTS_FORCE === "1";
  const hash = await inputHash();

  if (!force) {
    const stamp = await readFile(STAMP_FILE, "utf8").catch(() => null);
    const outputsPresent = (await Promise.all(OUTPUT_FILES.map(exists))).every(
      Boolean,
    );
    if (stamp?.trim() === hash && outputsPresent) {
      console.log("[buildFonts] up to date, skipping");
      return;
    }
  }

  // Cleared first and rewritten only after every output landed, so a
  // failed run never leaves a stamp vouching for partial output.
  await rm(STAMP_FILE, { force: true });
  await Promise.all([subsetCaprasimo(), instanceFraunces()]);
  await writeFile(STAMP_FILE, hash + "\n");
}

main().catch((error) => {
  console.error("[buildFonts] failed:", error);
  process.exit(1);
});
