import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FONT_TOOLCHAIN, fontToolchainVersions } from "./fontToolchain";

const buildFonts = path.join(import.meta.dirname, "../buildFonts.ts");

describe("fontToolchainVersions", () => {
  it("resolves every package that shapes the generated font bytes", () => {
    const versions = fontToolchainVersions(buildFonts);
    expect(versions.map((v) => v.slice(0, v.lastIndexOf("@")))).toEqual(
      FONT_TOOLCHAIN.map(([pkg]) => pkg),
    );
    for (const v of versions) expect(v).toMatch(/@\d+\.\d+\.\d+/);
  });

  // The stamp used to hash only subset-font's version, so a harfbuzzjs
  // bump kept stale fonts.
  it("covers harfbuzzjs and the woff2 encoder, not just subset-font", () => {
    const names = FONT_TOOLCHAIN.map(([pkg]) => pkg);
    expect(names).toEqual(
      expect.arrayContaining(["harfbuzzjs", "fontverter", "wawoff2"]),
    );
  });

  it("is what buildFonts.ts feeds into the stamp", () => {
    expect(readFileSync(buildFonts, "utf8")).toContain(
      "fontToolchainVersions(import.meta.filename)",
    );
  });
});
