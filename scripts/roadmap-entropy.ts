import { execFileSync } from "node:child_process";
import {
  buildReport,
  type Issue,
  type Milestone,
  type PullRequest,
  type Report,
} from "../lib/roadmap-entropy/roadmapEntropy";

// Roadmap entropy detector: how far has what shipped drifted from what the
// roadmap says? This repo has no ROADMAP file — the roadmap is the GitHub
// milestones — so this compares milestones against merged PRs and issues.
// Usage:
//   tsx scripts/roadmap-entropy.ts            markdown on stdout
//   tsx scripts/roadmap-entropy.ts --json     the raw numbers instead
//   tsx scripts/roadmap-entropy.ts --repo owner/name
//
// Read-only: three `gh` GETs and nothing else. It never edits a milestone
// or an issue; what to do about the findings is the owner's call.
//
// `gh` has to be able to see the repo. The active gh account on this
// machine is not necessarily the one that owns it — see RUNBOOK.md's
// "Roadmap entropy" section for the per-command GH_TOKEN form.
//
// The score formula, and what "planned", "area" and "anchored" mean, are
// documented at the top of lib/roadmap-entropy/roadmapEntropy.ts, next to
// the code that computes them.

const DEFAULT_REPO = "cam5/reading-rig";

// Comfortably above the repo's current totals. gh paginates up to this for
// us; if either list ever comes back exactly this long, the numbers are
// truncated and main() says so rather than reporting them as complete.
const LIMIT = 1000;

function gh(args: string[]): unknown {
  const out = execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function fetchMilestones(repo: string): Milestone[] {
  const raw = gh([
    "api",
    "--paginate",
    `repos/${repo}/milestones?state=all&per_page=100`,
  ]) as Array<{
    number: number;
    title: string;
    state: "open" | "closed";
    description: string | null;
    open_issues: number;
    closed_issues: number;
  }>;
  return raw
    .map((m) => ({
      number: m.number,
      title: m.title,
      state: m.state,
      description: m.description,
      openIssues: m.open_issues,
      closedIssues: m.closed_issues,
    }))
    .sort((a, b) => a.number - b.number);
}

function fetchIssues(repo: string): Issue[] {
  const raw = gh([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "all",
    "--limit",
    String(LIMIT),
    "--json",
    "number,title,state,milestone,createdAt,closedAt",
  ]) as Array<{
    number: number;
    title: string;
    state: string;
    milestone: { title: string } | null;
    createdAt: string;
    closedAt: string | null;
  }>;
  return raw.map((i) => ({
    number: i.number,
    title: i.title,
    state: i.state === "OPEN" ? "open" : "closed",
    milestone: i.milestone?.title ?? null,
    createdAt: i.createdAt,
    closedAt: i.closedAt,
  }));
}

function fetchPullRequests(repo: string): PullRequest[] {
  // `files` comes back capped at 100 per PR. That only blurs the area
  // classification of a PR touching more than 100 files, and primaryArea is
  // a majority vote, so the first 100 are a fair sample.
  const raw = gh([
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "all",
    "--limit",
    String(LIMIT),
    "--json",
    "number,title,milestone,mergedAt,closingIssuesReferences,files",
  ]) as Array<{
    number: number;
    title: string;
    milestone: { title: string } | null;
    mergedAt: string | null;
    closingIssuesReferences: Array<{ number: number }>;
    files: Array<{ path: string }>;
  }>;
  return raw.map((pr) => ({
    number: pr.number,
    title: pr.title,
    milestone: pr.milestone?.title ?? null,
    mergedAt: pr.mergedAt,
    closingIssues: pr.closingIssuesReferences.map((i) => i.number),
    files: pr.files.map((f) => f.path),
  }));
}

const pct = (n: number, d: number) =>
  d === 0 ? "—" : `${Math.round((n / d) * 100)}%`;

const day = (iso: string) => iso.slice(0, 10);

function table(header: string[], rows: Array<Array<string | number>>): string {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

function renderMarkdown(repo: string, now: Date, r: Report): string {
  const { score } = r;
  const staleByTitle = new Map(r.stale.map((s) => [s.title, s.reasons]));
  const out: string[] = [];

  out.push(`# Roadmap entropy — ${repo}`, "");
  out.push(`As of ${day(now.toISOString())}.`, "");
  out.push(`**Entropy score: ${score.score} / 100 (${score.band}).**`, "");
  out.push(
    table(
      ["Component", "Measured", "Points"],
      [
        [
          "Unplanned merged PRs",
          `${r.unplannedPrs} of ${r.mergedPrs} (${pct(r.unplannedPrs, r.mergedPrs)})`,
          `${score.components.unplannedWork.toFixed(1)} / 35`,
        ],
        [
          "Open issues with no milestone",
          `${r.openUnmilestoned.length} of ${r.openIssues} (${pct(r.openUnmilestoned.length, r.openIssues)})`,
          `${score.components.unsortedBacklog.toFixed(1)} / 25`,
        ],
        [
          "Stale open milestones",
          `${r.stale.length} of ${r.milestones.filter((m) => m.state === "open").length}`,
          `${score.components.staleMilestones.toFixed(1)} / 20`,
        ],
        [
          "Merged PRs in areas no milestone has reached",
          `${r.unanchoredPrs} of ${r.mergedPrs}`,
          `${score.components.unanchoredAreas.toFixed(1)} / 20`,
        ],
      ],
    ),
    "",
  );

  out.push("## Milestones", "");
  out.push(
    table(
      ["Milestone", "State", "Open", "Closed", "Flags"],
      r.milestones.map((m) => [
        m.title,
        m.state,
        m.openIssues,
        m.closedIssues,
        staleByTitle.get(m.title)?.join(", ") ?? "",
      ]),
    ),
    "",
  );

  out.push("## Unplanned work by week", "");
  out.push(
    "A merged PR is planned if it carries a milestone or closes an issue that does.",
    "",
  );
  out.push(
    table(
      ["Week of", "Merged PRs", "Unplanned", "Ratio"],
      r.weekly.map((w) => [
        w.week,
        w.merged,
        w.unplanned,
        pct(w.unplanned, w.merged),
      ]),
    ),
    "",
  );

  out.push("## Work by area", "");
  out.push(
    "Touching counts every merged PR with a file in the area, so a PR can appear in several rows. Primary counts each PR once, under the area most of its files fall in.",
    "",
  );
  out.push(
    table(
      ["Area", "Touching", "Planned", "Unplanned", "Primary", "First", "Last"],
      r.clusters.map((c) => [
        `\`${c.area}\``,
        c.touching,
        c.plannedTouching,
        c.unplannedTouching,
        c.primary,
        day(c.firstMergedAt),
        day(c.lastMergedAt),
      ]),
    ),
    "",
  );

  const prList = (c: { unplannedPrs: number[] }) =>
    c.unplannedPrs.map((n) => `#${n}`).join(", ");

  out.push("## Scope-creep candidates", "");
  if (r.creep.length === 0) {
    out.push("None: every area with two or more PRs has planned work in it.");
  } else {
    out.push(
      "Areas two or more merged PRs have touched, none of them planned:",
      "",
    );
    for (const c of r.creep) {
      out.push(
        `- \`${c.area}\` — ${c.touching} PRs, ${day(c.firstMergedAt)} to ${day(c.lastMergedAt)}: ${prList(c)}`,
      );
    }
  }
  if (r.watch.length > 0) {
    out.push("", "Touched once, by an unplanned PR — not yet a pattern:", "");
    for (const c of r.watch) {
      out.push(`- \`${c.area}\` — ${prList(c)} (${day(c.firstMergedAt)})`);
    }
  }
  out.push("");

  out.push("## Issue flow by week", "");
  out.push(
    table(
      ["Week of", "Opened", "Closed", "Net"],
      r.flow.map((w) => [
        w.week,
        w.opened,
        w.closed,
        w.net > 0 ? `+${w.net}` : w.net,
      ]),
    ),
    "",
  );

  out.push("## Open issues with no milestone", "");
  if (r.openUnmilestoned.length === 0) {
    out.push("None.");
  } else {
    const ages = r.openUnmilestonedAges;
    out.push(
      `${ages.count} open, median age ${ages.medianDays} days, oldest ${ages.maxDays} days.`,
      "",
    );
    for (const i of r.openUnmilestoned) {
      out.push(`- #${i.number} (${day(i.createdAt)}) ${i.title}`);
    }
  }
  out.push("");

  return out.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const repoFlag = args.indexOf("--repo");
  const repo = repoFlag === -1 ? DEFAULT_REPO : args[repoFlag + 1];
  if (!repo) {
    console.error(
      "Usage: tsx scripts/roadmap-entropy.ts [--json] [--repo owner/name]",
    );
    process.exit(1);
  }

  const milestones = fetchMilestones(repo);
  const issues = fetchIssues(repo);
  const prs = fetchPullRequests(repo);
  if (issues.length >= LIMIT || prs.length >= LIMIT) {
    console.error(
      `Hit the ${LIMIT}-item fetch limit — the numbers below are truncated. Raise LIMIT in scripts/roadmap-entropy.ts.`,
    );
  }

  const now = new Date();
  const report = buildReport(milestones, issues, prs, now);
  console.log(
    json
      ? JSON.stringify({ repo, asOf: now.toISOString(), ...report }, null, 2)
      : renderMarkdown(repo, now, report),
  );
}

main();
