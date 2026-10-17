import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
  GIT_LOG_FORMAT,
  computeAreaStats,
  detectSilos,
  findDocumentedAreas,
  parseGitLog,
  renderJson,
  renderMarkdown,
  summarizeAuthors,
  type Report,
} from "../lib/knowledge-silo/analyze";

// Read-only report of which parts of the repo only one person really knows,
// from git history alone (see lib/knowledge-silo/analyze.ts for the
// heuristics). Never touches the database, .env or the network, and exits 0
// even when silos are found — it's information, not a CI gate. Usage:
//   tsx scripts/knowledgeSilo.ts [--since=<date>] [--depth=2]
//     [--min-commits=3] [--half-life=180] [--concentration=0.8]
//     [--stale-days=180] [--format=md|json] [--out=<file>]

function usageError(message: string): never {
  console.error(
    `${message}\n\nUsage:\n` +
      "  tsx scripts/knowledgeSilo.ts [--since=<date>] [--depth=2] [--min-commits=3]\n" +
      "    [--half-life=180] [--concentration=0.8] [--stale-days=180]\n" +
      "    [--format=md|json] [--out=<file>]",
  );
  process.exit(1);
}

const known = new Set([
  "since",
  "depth",
  "min-commits",
  "half-life",
  "concentration",
  "stale-days",
  "format",
  "out",
]);

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) usageError(`Unrecognised argument: ${argv[i]}`);
    if (!known.has(m[1])) usageError(`Unknown flag: --${m[1]}`);
    const value = m[2] ?? argv[++i];
    if (value === undefined) usageError(`--${m[1]} needs a value`);
    args.set(m[1], value);
  }
  return args;
}

function numberArg(args: Map<string, string>, key: string, fallback: number) {
  const raw = args.get(key);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) usageError(`--${key} must be a number`);
  return n;
}

function git(args: string[]): string {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
}

const args = parseArgs(process.argv.slice(2));

const since = args.get("since");
const depth = numberArg(args, "depth", 2);
const minCommits = numberArg(args, "min-commits", 3);
const halfLifeDays = numberArg(args, "half-life", 180);
const concentration = numberArg(args, "concentration", 0.8);
const staleDays = numberArg(args, "stale-days", 180);
const format = args.get("format") ?? "md";
if (format !== "md" && format !== "json") {
  usageError("--format must be md or json");
}

// %aN/%aE (not %an/%ae) so the repo's .mailmap folds aliases together.
const raw = git([
  "log",
  "--use-mailmap",
  "--no-merges",
  "--numstat",
  `--format=${GIT_LOG_FORMAT}`,
  ...(since ? [`--since=${since}`] : []),
]);
const commits = parseGitLog(raw);
const now = Math.floor(Date.now() / 1000);
const areas = computeAreaStats(commits, {
  now,
  depth,
  minCommits,
  halfLifeDays,
});
const report: Report = {
  generatedAt: now,
  options: { since, depth, minCommits, halfLifeDays, concentration, staleDays },
  totals: summarizeAuthors(commits),
  areas,
  silos: detectSilos(areas, { now, concentration, staleDays }),
  documentedAreas: findDocumentedAreas(
    areas.map((a) => a.area),
    git(["ls-files"]).split("\n").filter(Boolean),
    depth,
  ),
};

const output = format === "json" ? renderJson(report) : renderMarkdown(report);
const out = args.get("out");
if (out) {
  writeFileSync(out, output);
  console.error(`Wrote ${report.silos.length} silos to ${out}`);
} else {
  process.stdout.write(output);
}
