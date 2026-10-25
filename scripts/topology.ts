import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildGraph,
  findViolations,
  renderMarkdown,
  selectSourcePaths,
  type SourceFile,
} from "./lib/topology";

// Writes TOPOLOGY.md: the layer-level import graph of everything git
// tracks or would track (untracked but not ignored), plus a check of the
// README's "app/domain has no React, no SDK" rule. The parsing and
// rendering live in lib/topology.ts; this is just the fs/git glue around it.
//
//   npm run topology               regenerate TOPOLOGY.md
//   npm run topology -- --check    write nothing; exit 1 if TOPOLOGY.md is
//                                  stale or the layering rule is broken
//   npm run topology -- --stdout   print instead of writing

const ROOT = path.join(import.meta.dirname, "..");
const OUT_FILE = path.join(ROOT, "TOPOLOGY.md");
const PARSED = /\.(ts|tsx|mjs)$/;
// `(\/|$)`: a symlinked node_modules (as in a worktree) is a file to git,
// so `node_modules/` in .gitignore doesn't hide it from `--others`.
const EXCLUDED = /^(generated|build|storybook-static|node_modules)(\/|$)/;

const args = new Set(process.argv.slice(2));

const gitLsFiles = (...flags: string[]) =>
  execFileSync("git", ["ls-files", "-z", ...flags], {
    cwd: ROOT,
    encoding: "utf8",
  }).split("\0");

const tracked = selectSourcePaths(
  gitLsFiles("--cached", "--others", "--exclude-standard"),
  gitLsFiles("--deleted"),
).filter((p) => !EXCLUDED.test(p));

const files: SourceFile[] = await Promise.all(
  tracked.map(async (p) =>
    PARSED.test(p)
      ? { path: p, source: await readFile(path.join(ROOT, p), "utf8") }
      : { path: p },
  ),
);

const graph = buildGraph(files);
const violations = findViolations(graph);
const markdown = renderMarkdown(graph, violations);

if (args.has("--stdout")) {
  process.stdout.write(markdown);
} else if (args.has("--check")) {
  const current = await readFile(OUT_FILE, "utf8").catch(() => "");
  let ok = true;
  if (current !== markdown) {
    console.error("TOPOLOGY.md is stale — run `npm run topology`.");
    ok = false;
  }
  for (const v of violations) {
    console.error(`${v.file}: ${v.reason} (${v.specifier})`);
    ok = false;
  }
  if (!ok) process.exit(1);
  console.log("TOPOLOGY.md is up to date; no layering violations.");
} else {
  await writeFile(OUT_FILE, markdown);
  console.log(`Wrote ${path.relative(process.cwd(), OUT_FILE)}`);
  for (const v of violations) {
    console.warn(`layering violation — ${v.file}: ${v.reason}`);
  }
}
