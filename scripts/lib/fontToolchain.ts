import { createRequire } from "node:module";
import path from "node:path";

// subset-font doesn't do the font work itself: harfbuzzjs (wasm) does the
// subsetting and instancing, and fontverter → wawoff2 does the woff2
// encode. All three float on caret ranges under subset-font, so a lockfile
// bump to any of them can change the output bytes without subset-font's
// own version moving — buildFonts.ts's stamp has to hash every one.
//
// Each package is resolved from the one that depends on it, so a nested
// copy is found the same way Node finds it at runtime.
export const FONT_TOOLCHAIN: ReadonlyArray<
  readonly [pkg: string, parent: string | null]
> = [
  ["subset-font", null],
  ["harfbuzzjs", "subset-font"],
  ["fontverter", "subset-font"],
  ["wawoff2", "fontverter"],
];

/** `name@version` for every package in FONT_TOOLCHAIN, resolved from `fromFile`. */
export function fontToolchainVersions(fromFile: string): string[] {
  const packageJsonOf = new Map<string, string>();
  return FONT_TOOLCHAIN.map(([pkg, parent]) => {
    const require = createRequire(
      parent === null ? fromFile : packageJsonOf.get(parent)!,
    );
    const packageJson = require.resolve(`${pkg}/package.json`);
    packageJsonOf.set(pkg, packageJson);
    return `${pkg}@${require(packageJson).version}`;
  });
}
