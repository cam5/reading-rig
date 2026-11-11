import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  type CommitFact,
  type PostmortemFacts,
  type PostmortemSource,
  type PullRequestFact,
  incidentDate,
  renderPostmortem,
  slugify,
} from "./lib/postmortem";

// Drafts a blameless postmortem into docs/postmortems/ from what git (and,
// when it's installed and authenticated, gh) already knows. Offline by
// design: no LLM, no API beyond the gh calls you're already logged in for,
// no database, no .env — so none of AGENTS.md's worktree dev.db rules apply.
// The judgment sections are left as TODOs; see scripts/lib/postmortem.ts.
//
// Usage:
//   npm run postmortem -- <PR number>
//   npm run postmortem -- <commit SHA>
//   npm run postmortem -- --since <date> [--until <date>]
// Flags: --slug <slug>  --stdout (preview, write nothing)  --force (overwrite)

const REPO = "cam5/reading-rig";
const OUT_DIR = "docs/postmortems";

function usageError(message?: string): never {
  if (message) console.error(message);
  console.error(
    "Usage:\n" +
      "  npm run postmortem -- <PR number> [--slug s] [--stdout] [--force]\n" +
      "  npm run postmortem -- <commit SHA> [--slug s] [--stdout] [--force]\n" +
      "  npm run postmortem -- --since <date> [--until <date>] [--slug s] [--stdout] [--force]",
  );
  process.exit(1);
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function tryGit(args: string[]): string | null {
  try {
    return git(args);
  } catch {
    return null;
  }
}

// Unit/record separators so subjects and bodies can contain anything.
const US = "\x1f";
const RS = "\x1e";
const LOG_FORMAT = `--format=%H${US}%cI${US}%s${US}%b${RS}`;

function parseLog(output: string): CommitFact[] {
  return output
    .split(RS)
    .map((r) => r.replace(/^\n+/, ""))
    .filter((r) => r.trim())
    .map((record) => {
      const [sha, date, subject, body] = record.split(US);
      return { sha, date, subject, body: body?.trim() || undefined };
    });
}

function filesForCommit(sha: string): string[] | undefined {
  const out = tryGit(["show", "--name-only", "--format=", sha]);
  return out === null ? undefined : out.split("\n").filter(Boolean);
}

function withFiles(commits: CommitFact[]): CommitFact[] {
  return commits.map((c) => ({ ...c, files: filesForCommit(c.sha) }));
}

type GhPr = {
  number: number;
  title: string;
  body: string;
  createdAt: string;
  mergedAt: string | null;
  mergeCommit: { oid: string } | null;
  commits: {
    oid: string;
    messageHeadline: string;
    messageBody: string;
    committedDate: string;
  }[];
  files: { path: string }[];
  closingIssuesReferences: { number: number }[];
};

function ghPrView(n: number): GhPr | null {
  try {
    const out = execFileSync(
      "gh",
      [
        "pr",
        "view",
        String(n),
        "--repo",
        REPO,
        "--json",
        "number,title,body,createdAt,mergedAt,mergeCommit,commits,files,closingIssuesReferences",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return JSON.parse(out) as GhPr;
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr: unknown }).stderr).trim()
        : String(error);
    console.warn(
      `warning: \`gh pr view ${n}\` failed (${stderr.split("\n")[0] || "gh unavailable"}) — falling back to git only.`,
    );
    return null;
  }
}

// gh wraps long subjects: the headline ends "cra…" and the body starts
// "…shing prod". Stitch them back together.
function splitGhMessage(
  headline: string,
  body: string,
): { subject: string; body?: string } {
  if (headline.endsWith("…") && body.startsWith("…")) {
    const [rest, ...lines] = body.slice(1).split("\n");
    return {
      subject: headline.slice(0, -1) + rest,
      body: lines.join("\n").trim() || undefined,
    };
  }
  return { subject: headline, body: body || undefined };
}

function factsForPr(n: number): Omit<PostmortemFacts, "generatedAt"> {
  const source: PostmortemSource = { kind: "pr", number: n };
  const pr = ghPrView(n);
  if (pr) {
    const prFact: PullRequestFact = {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      createdAt: pr.createdAt,
      mergedAt: pr.mergedAt,
      files: pr.files.map((f) => f.path),
      closingIssues: pr.closingIssuesReferences.map((i) => i.number),
    };
    // Branch commits often aren't local (squash merge + deleted branch);
    // fall back to the PR's file list for them, and add the squash/merge
    // commit itself when we have it.
    const branchCommits: CommitFact[] = pr.commits.map((c) => ({
      sha: c.oid,
      ...splitGhMessage(c.messageHeadline, c.messageBody),
      date: c.committedDate,
      files: filesForCommit(c.oid),
    }));
    const merge = pr.mergeCommit
      ? parseLog(tryGit(["log", "-1", LOG_FORMAT, pr.mergeCommit.oid]) ?? "")
      : [];
    return {
      source,
      title: pr.title,
      pullRequests: [prFact],
      commits: [...branchCommits, ...withFiles(merge)],
    };
  }
  // git only: squash merges on main carry "(#N)" in the subject.
  const commits = withFiles(
    parseLog(
      git(["log", "--fixed-strings", `--grep=(#${n})`, LOG_FORMAT, "main"]),
    ),
  );
  if (commits.length === 0) {
    usageError(`No commit on main mentions (#${n}) and gh is unavailable.`);
  }
  return {
    source,
    title: commits[0].subject.replace(/\s*\(#\d+\)$/, ""),
    pullRequests: [],
    commits,
    gitOnly: true,
  };
}

function factsForCommit(sha: string): Omit<PostmortemFacts, "generatedAt"> {
  const log = tryGit(["log", "-1", LOG_FORMAT, sha]);
  if (log === null) usageError(`git doesn't know a commit ${sha}.`);
  const commits = withFiles(parseLog(log));
  return {
    source: { kind: "commit", sha: commits[0].sha },
    title: commits[0].subject.replace(/\s*\(#\d+\)$/, ""),
    pullRequests: [],
    commits,
    gitOnly: true,
  };
}

function factsForRange(
  since: string,
  until: string | undefined,
): Omit<PostmortemFacts, "generatedAt"> {
  const args = ["log", `--since=${since}`, LOG_FORMAT];
  if (until) args.push(`--until=${until}`);
  args.push("main");
  const commits = withFiles(parseLog(git(args)));
  if (commits.length === 0) {
    usageError(`No commits on main between ${since} and ${until ?? "now"}.`);
  }
  return {
    source: { kind: "range", since, until },
    title: `Incident ${since}${until ? ` – ${until}` : ""}`,
    pullRequests: [],
    // git log is newest-first; the doc reads oldest-first.
    commits: commits.reverse(),
    gitOnly: true,
  };
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      since: { type: "string" },
      until: { type: "string" },
      slug: { type: "string" },
      stdout: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
    },
  });

  const [target, ...extra] = positionals;
  if (extra.length > 0) usageError(`Unexpected arguments: ${extra.join(" ")}`);
  if (values.until && !values.since) usageError("--until needs --since.");
  if (Boolean(target) === Boolean(values.since)) {
    usageError("Give exactly one of: a PR number, a commit SHA, or --since.");
  }

  let gathered: Omit<PostmortemFacts, "generatedAt">;
  if (values.since) {
    gathered = factsForRange(values.since, values.until);
  } else if (/^#?\d{1,5}$/.test(target)) {
    gathered = factsForPr(Number(target.replace("#", "")));
  } else if (/^[0-9a-f]{6,40}$/i.test(target)) {
    gathered = factsForCommit(target);
  } else {
    usageError(`Not a PR number or commit SHA: ${target}`);
  }

  const facts: PostmortemFacts = {
    ...gathered,
    generatedAt: new Date().toISOString(),
  };
  const markdown = renderPostmortem(facts);

  if (values.stdout) {
    process.stdout.write(markdown);
    return;
  }

  const slug = values.slug ? slugify(values.slug) : slugify(facts.title);
  const file = path.join(OUT_DIR, `${incidentDate(facts)}-${slug}.md`);
  if (fs.existsSync(file) && !values.force) {
    console.error(`${file} already exists — pass --force to overwrite.`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(file, markdown);
  console.log(file);
  console.log(`Run \`npx prettier --write ${file}\` before committing.`);
}

main();
