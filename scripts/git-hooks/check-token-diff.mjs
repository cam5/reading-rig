import { execFileSync } from "node:child_process";

// Pure parse-and-diff, no model call: the @theme block in organic.css is
// flat `--name: value;` declarations with no nested braces (color-mix()/
// calc() use parens, not braces), so lifting it out and comparing two
// Maps is exact and instant — there's no judgment call here for an LLM to
// earn its cost on. See the design-token-hook PR for why an earlier draft
// of this hook used `claude -p` and why that got dropped.

/** @param {string} css */
export function parseThemeTokens(css) {
  const match = css.match(/@theme\s*{([\s\S]*?)\n}/);
  if (!match) return new Map();

  const tokens = new Map();
  for (const line of match[1].split("\n")) {
    const decl = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?);\s*(?:\/\*.*\*\/)?\s*$/);
    if (decl) tokens.set(decl[1], decl[2].trim());
  }
  return tokens;
}

/**
 * @param {Map<string, string>} oldTokens
 * @param {Map<string, string>} newTokens
 */
export function diffTokens(oldTokens, newTokens) {
  const names = new Set([...oldTokens.keys(), ...newTokens.keys()]);
  const changes = [];
  for (const name of names) {
    const before = oldTokens.get(name);
    const after = newTokens.get(name);
    if (before === after) continue;
    if (before === undefined) changes.push(`+ ${name}: ${after}`);
    else if (after === undefined) changes.push(`- ${name}: ${before}`);
    else changes.push(`~ ${name}: ${before} -> ${after}`);
  }
  return changes.sort();
}

function fileAtRef(ref, filePath) {
  try {
    return execFileSync("git", ["show", `${ref}:${filePath}`], { encoding: "utf8" });
  } catch {
    // File didn't exist at that ref (e.g. newly added) — treat as empty.
    return "";
  }
}

function main() {
  const [, , oldRef, newRef, filePath] = process.argv;
  const oldTokens = parseThemeTokens(fileAtRef(oldRef, filePath));
  const newTokens = parseThemeTokens(fileAtRef(newRef, filePath));
  const changes = diffTokens(oldTokens, newTokens);

  if (changes.length === 0) return;

  console.log(`organic.css design tokens changed in this commit:\n`);
  for (const line of changes) console.log(`  ${line}`);
  console.log(`\nConsider updating the matching Figma variable(s).`);
}

// Only run as a CLI when invoked directly, not when imported for tests.
if (import.meta.url === `file://${process.argv[1]}`) main();
