import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  NUMSTAT_LOG_FORMAT,
  analyze,
  formatReport,
  parseNumstatLog,
} from "./lib/busFactor";

// Code-ownership concentration from git history — see scripts/lib/busFactor.ts
// for what's measured, and RUNBOOK.md for how to read the output. Read-only:
// runs `git` and prints to stdout, never touches the repo or a database.
// Usage:
//   tsx scripts/busFactor.ts [--since <date>] [--depth <n>] [--threshold <0..1>] [--json]

function usageError(message: string): never {
  console.error(
    `${message}\n\nUsage:\n` +
      "  tsx scripts/busFactor.ts [--since <date>] [--depth <n>] [--threshold <0..1>] [--json]",
  );
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const opts = {
    since: undefined as string | undefined,
    depth: 2,
    threshold: 0.5,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i] ?? usageError(`${arg} needs a value`);
    switch (arg) {
      case "--since":
        opts.since = value();
        break;
      case "--depth":
        opts.depth = Number(value());
        if (!Number.isInteger(opts.depth) || opts.depth < 1)
          usageError("--depth must be a positive integer");
        break;
      case "--threshold":
        opts.threshold = Number(value());
        if (!(opts.threshold > 0 && opts.threshold < 1))
          usageError("--threshold must be between 0 and 1");
        break;
      case "--json":
        opts.json = true;
        break;
      default:
        usageError(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const repoRoot = path.join(import.meta.dirname, "..");
// core.quotePath=false keeps non-ASCII paths verbatim rather than C-quoted,
// so `git log` paths and `git ls-files` paths match each other.
const git = (args: string[]) =>
  execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

const liveFiles = git(["ls-files"]).split("\n").filter(Boolean);
const commits = parseNumstatLog(
  git([
    "log",
    "--numstat",
    `--format=${NUMSTAT_LOG_FORMAT}`,
    ...(opts.since ? [`--since=${opts.since}`] : []),
  ]),
);

const report = analyze(commits, liveFiles, {
  depth: opts.depth,
  threshold: opts.threshold,
  since: opts.since,
});
process.stdout.write(
  formatReport(report, { format: opts.json ? "json" : "markdown" }),
);
