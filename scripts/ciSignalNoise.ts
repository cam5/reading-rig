import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import {
  belowMinScore,
  capFileList,
  formatScore,
  MAX_API_FILES,
  mergeRunPage,
  renderMarkdown,
  scoreRuns,
  type WorkflowRun,
} from "./lib/ciSignalNoise";

// Scores recent GitHub Actions runs as signal vs noise and prints the
// scorecard — Markdown for a step summary or PR body by default, JSON on
// request. Read-only: nothing here writes to the repo or to GitHub. The
// classification and arithmetic live in lib/ciSignalNoise.ts; this file is
// the `gh` glue around them (same split as topology / lighthouse-summary).
//
//   npm run ci:signal                      last 200 runs of the current repo
//   npm run ci:signal -- --limit 500
//   npm run ci:signal -- --json
//   npm run ci:signal -- --min-score 75    exit 1 if the overall score is lower
//   npm run ci:signal -- --repo owner/name
//
// Exit codes: 0 scored (and passed any --min-score); 1 the --min-score gate
// failed; 2 couldn't run at all (gh missing or unauthenticated, bad flag).
//
// Not a workflow of its own on purpose: a scheduled scorer would add a run
// per schedule tick, which is noise by its own definition.
//
// Changed files per run come from one extra API call each, memoized on the
// compare spec so the three web workflows triggered by the same push share
// a lookup:
//   pull_request  compare/{base}...{head} — three-dot, so GitHub picks the
//                 merge base and the diff is the PR's own. `base` is the
//                 run's pull_requests[0].base.sha when the API still
//                 reports it; closed PRs lose that array, so the default
//                 branch stands in (same merge-base, same answer, except
//                 for a stacked PR whose parent hasn't merged — more files,
//                 which only ever errs toward signal).
//   push          commits/{head} — squash merges carry the whole PR diff
//                 in that one commit.
// A failed lookup leaves the run's files null; the lib scores that as
// signal and reports it as unknown rather than guessing.

interface ApiRun {
  id: number;
  name: string;
  path: string;
  event: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
  run_attempt: number;
  run_started_at?: string;
  created_at: string;
  updated_at: string;
  pull_requests?: { base: { sha: string } }[];
}

const PAGE_SIZE = 100;

function fail(message: string): never {
  console.error(`ci:signal: ${message}`);
  process.exit(2);
}

// Everything below is synchronous and every failure is an API call that
// didn't go our way (a wrong --repo, an expired token mid-run) — the
// message is the whole story, so no stack trace.
process.on("uncaughtException", (err) => fail(err.message));

function gh(args: string[]): string {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ENOENT")
      fail("`gh` is not installed — see https://cli.github.com");
    throw new Error((e.stderr ?? e.message).trim());
  }
}

let options;
try {
  options = parseArgs({
    options: {
      limit: { type: "string", default: "200" },
      json: { type: "boolean", default: false },
      "min-score": { type: "string" },
      repo: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  }).values;
} catch (err) {
  fail((err as Error).message);
}

if (options.help) {
  console.log(
    "usage: npm run ci:signal -- [--limit N] [--json] [--min-score N] [--repo owner/name]",
  );
  process.exit(0);
}

const limit = Number(options.limit);
if (!Number.isInteger(limit) || limit < 1)
  fail(`--limit must be a positive integer, got ${options.limit}`);

const minScore =
  options["min-score"] === undefined ? undefined : Number(options["min-score"]);
if (minScore !== undefined && !Number.isFinite(minScore))
  fail(`--min-score must be a number, got ${options["min-score"]}`);

try {
  gh(["auth", "status"]);
} catch (err) {
  fail(
    `gh is not authenticated — run \`gh auth login\`.\n${(err as Error).message}`,
  );
}

const repo =
  options.repo ??
  gh([
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]).trim();
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail(`not an owner/name repo: ${repo}`);

// `spec` is the path under the repo; empty for the repo itself (no
// trailing slash — GitHub 404s on `repos/owner/name/`).
const api = (spec: string, jq?: string) =>
  gh([
    "api",
    spec ? `repos/${repo}/${spec}` : `repos/${repo}`,
    ...(jq ? ["--jq", jq] : []),
  ]);
const apiJson = <T>(spec: string, jq?: string) =>
  JSON.parse(api(spec, jq)) as T;

const defaultBranch = apiJson<{ default_branch: string }>("").default_branch;

// Newest first, as the API returns them; paged until the limit or the end.
console.error(`Fetching up to ${limit} runs of ${repo}…`);
let raw: ApiRun[] = [];
for (let page = 1; raw.length < limit; page++) {
  const batch = apiJson<ApiRun[]>(
    `actions/runs?per_page=${PAGE_SIZE}&page=${page}`,
    ".workflow_runs",
  );
  raw = mergeRunPage(raw, batch);
  if (batch.length < PAGE_SIZE) break;
}
raw.splice(limit);

// A re-run replaces the run in the list (same id, run_attempt bumped), so
// the attempt that failed is only visible through the attempts endpoint.
// Pull those in as runs of their own so the lib can pair them up as flaky.
const attempts: ApiRun[] = [];
for (const r of raw) {
  for (let n = 1; n < r.run_attempt; n++) {
    try {
      attempts.push(apiJson<ApiRun>(`actions/runs/${r.id}/attempts/${n}`));
    } catch (err) {
      console.error(
        `  attempt ${n} of run ${r.id} unavailable: ${(err as Error).message}`,
      );
    }
  }
}
const all = [...raw, ...attempts];

const filesMemo = new Map<string, readonly string[] | null>();
function changedFiles(r: ApiRun): readonly string[] | null {
  let spec: string;
  if (r.event === "pull_request") {
    const base = r.pull_requests?.[0]?.base.sha ?? defaultBranch;
    spec = `compare/${base}...${r.head_sha}`;
  } else if (r.event === "push") {
    spec = `commits/${r.head_sha}`;
  } else {
    return null;
  }
  if (!filesMemo.has(spec)) {
    try {
      const files = capFileList(
        apiJson<string[]>(spec, "[.files[]?.filename]"),
      );
      if (files === null)
        console.error(`  ${spec}: ${MAX_API_FILES}+ files, treated as unknown`);
      filesMemo.set(spec, files);
    } catch (err) {
      console.error(`  ${spec}: ${(err as Error).message}`);
      filesMemo.set(spec, null);
    }
  }
  return filesMemo.get(spec) ?? null;
}

console.error(`Resolving changed files for ${all.length} runs…`);
const runs: WorkflowRun[] = all.map((r) => ({
  id: r.id,
  workflow: r.name,
  workflowPath: r.path ?? null,
  event: r.event,
  status: r.status,
  conclusion: r.conclusion,
  headSha: r.head_sha,
  baseSha: r.pull_requests?.[0]?.base.sha ?? null,
  runAttempt: r.run_attempt,
  startedAt: r.run_started_at ?? r.created_at,
  updatedAt: r.updated_at,
  changedFiles: changedFiles(r),
}));
console.error(`  ${filesMemo.size} distinct diffs looked up.`);

const card = scoreRuns(runs);

if (options.json) console.log(JSON.stringify(card, null, 2));
else process.stdout.write(renderMarkdown(card));

if (minScore !== undefined) {
  const score = card.overall.score;
  if (belowMinScore(score, minScore)) {
    console.error(
      `Overall signal-to-noise ${score === null ? "could not be scored" : formatScore(score)} ` +
        `is below --min-score ${minScore}.`,
    );
    process.exit(1);
  }
}
