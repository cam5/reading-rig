/**
 * Pure helpers behind `npm run postmortem` (scripts/postmortem.ts). Nothing
 * in here shells out, reads the filesystem, or touches the network — the
 * CLI gathers facts from git/gh and hands them over as plain data, so every
 * function below is testable on the same terms as lib/** and app/domain/**.
 *
 * The generator only ever fills in *facts* (titles, timestamps, changed
 * files, linked refs). Anything that needs human judgment — impact, root
 * cause, lessons — is left as an explicit `<!-- TODO: -->` prompt, seeded
 * with the evidence gathered, never guessed at. A draft that reads as
 * finished but invents an incident detail is worse than one that is
 * obviously unfinished.
 */

/** The failure classes RUNBOOK.md's "Health snapshot → logs → classify" uses, plus iOS. */
export type IncidentCategory =
  "build" | "release-migration" | "runtime-config" | "client-ios" | "unknown";

export const CATEGORY_LABELS: Record<IncidentCategory, string> = {
  build: "Build failure",
  "release-migration": "Release/migration failure",
  "runtime-config": "Runtime/config failure",
  "client-ios": "Client (iOS/macOS) failure",
  unknown: "Unknown — classify by hand",
};

/** Paths whose changes are the usual suspects for a broken deploy. */
export const TRIGGER_PATHS = [
  "prisma/migrations/",
  "prisma/schema.prisma",
  "scripts/release.ts",
  "railway.toml",
];

/**
 * The template's headings, in order. TEMPLATE.md and renderPostmortem are
 * kept in lockstep by a test (postmortem.test.ts) rather than by having this
 * module read the template off disk.
 */
export const POSTMORTEM_HEADINGS = [
  "Summary",
  "Impact",
  "Timeline (UTC)",
  "Detection",
  "Root cause",
  "Trigger",
  "Resolution and recovery",
  "What went well / what went poorly",
  "Action items",
  "Related PRs, commits and issues",
] as const;

/** Sections only a human can write — each must carry a TODO marker. */
export const HUMAN_ONLY_HEADINGS = [
  "Impact",
  "Detection",
  "Root cause",
  "Resolution and recovery",
  "What went well / what went poorly",
  "Action items",
] as const;

export function slugify(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      // "#188" / "(#188)" are noise in a filename — the PR number is in the doc.
      .replace(/\(?#\d+\)?/g, " ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "incident"
  );
}

type Rule = { pattern: RegExp; weight: number };

// Weighted rather than first-match: real incident text mentions several
// classes at once (#188's title says both "migration" and "crashing prod").
// A migration that crash-loops the service is still a release/migration
// failure per RUNBOOK.md — release exits non-zero before the server ever
// starts — so migration signals outweigh generic crash/502 ones.
const RULES: Record<Exclude<IncidentCategory, "unknown">, Rule[]> = {
  "release-migration": [
    { pattern: /prisma\/migrations\//, weight: 4 },
    { pattern: /scripts\/release\.ts/, weight: 4 },
    { pattern: /\bmigrat(e|ion|ions|ing)\b/, weight: 3 },
    { pattern: /\bbackfill/, weight: 3 },
    { pattern: /\bnot null\b/, weight: 2 },
    { pattern: /\bmigrate (deploy|resolve|reset|status)\b/, weight: 2 },
    { pattern: /\bnpm run release\b|\brelease step\b/, weight: 2 },
    { pattern: /\bschema\b/, weight: 1 },
    { pattern: /\bseed(ing)?\b/, weight: 1 },
  ],
  build: [
    { pattern: /\bbuild (failure|failed|fails|log|step|broke)\b/, weight: 4 },
    { pattern: /\bnixpacks\b/, weight: 3 },
    { pattern: /\b(tsc|typecheck|type error)\b/, weight: 2 },
    { pattern: /\b(vite|rollup|bundle|compile)\b/, weight: 1 },
    { pattern: /\bnpm ci\b|\bpostinstall\b|\blockfile\b/, weight: 2 },
  ],
  "runtime-config": [
    { pattern: /railway\.toml/, weight: 3 },
    { pattern: /\b(env var|environment variable|missing env)\b/, weight: 3 },
    { pattern: /\bstartcommand\b|\bhealthz\b|\bhealthcheck\b/, weight: 2 },
    { pattern: /\b(crash(ed|es|ing)?|crash-loop\w*|502s?|500s?)\b/, weight: 1 },
    { pattern: /\b(runtime|config|boot)\b/, weight: 1 },
  ],
  "client-ios": [
    { pattern: /\b(ios|ipados|macos)\b/, weight: 3 },
    {
      pattern: /\b(xcode|xcodegen|swift|swiftui|codesign|testflight)\b/,
      weight: 3,
    },
    { pattern: /\.swift\b|\.xcodeproj\b|project\.yml/, weight: 3 },
  ],
};

// Tie-break order: the RUNBOOK's own order (earliest failure point first).
const CATEGORY_ORDER: Exclude<IncidentCategory, "unknown">[] = [
  "build",
  "release-migration",
  "runtime-config",
  "client-ios",
];

export type Classification = {
  category: IncidentCategory;
  label: string;
  scores: Record<Exclude<IncidentCategory, "unknown">, number>;
};

export function classifyIncident(text: string): Classification {
  const haystack = text.toLowerCase();
  const scores = {
    build: 0,
    "release-migration": 0,
    "runtime-config": 0,
    "client-ios": 0,
  };
  for (const category of CATEGORY_ORDER) {
    for (const { pattern, weight } of RULES[category]) {
      if (pattern.test(haystack)) scores[category] += weight;
    }
  }
  let best: IncidentCategory = "unknown";
  let bestScore = 0;
  for (const category of CATEGORY_ORDER) {
    if (scores[category] > bestScore) {
      best = category;
      bestScore = scores[category];
    }
  }
  return { category: best, label: CATEGORY_LABELS[best], scores };
}

export type TimelineEventKind = "commit" | "pr-opened" | "pr-merged" | "deploy";

export type TimelineEvent = {
  at: string | Date;
  kind: TimelineEventKind;
  label: string;
  /** Stable identity (a SHA, "pr-188-merged") — used to dedupe. */
  ref?: string;
};

export type TimelineRow = {
  /** `YYYY-MM-DD HH:MM` in UTC. */
  at: string;
  iso: string;
  kind: TimelineEventKind;
  label: string;
};

function toUtcRow(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * Sorted ascending, deduped (by `ref` when present, else by
 * time+kind+label), invalid timestamps dropped. The same commit can arrive
 * twice — once from `gh pr view`, once from `git log` — which is what the
 * dedupe is for.
 */
export function buildTimeline(events: TimelineEvent[]): TimelineRow[] {
  const seen = new Set<string>();
  const rows: (TimelineRow & { ms: number; order: number })[] = [];
  events.forEach((event, order) => {
    const date = event.at instanceof Date ? event.at : new Date(event.at);
    const ms = date.getTime();
    if (Number.isNaN(ms)) return;
    const key = event.ref ?? `${ms}|${event.kind}|${event.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      at: toUtcRow(date),
      iso: date.toISOString(),
      kind: event.kind,
      label: event.label,
      ms,
      order,
    });
  });
  rows.sort((a, b) => a.ms - b.ms || a.order - b.order);
  return rows.map(({ at, iso, kind, label }) => ({ at, iso, kind, label }));
}

export type LinkedRefs = {
  /** Every `#NNN` mentioned, ascending, deduped. */
  refs: number[];
  /** The subset named by a closing keyword (`Fixes #NNN`, `Closes #NNN`…). */
  closes: number[];
};

export function extractLinkedRefs(text: string): LinkedRefs {
  const refs = new Set<number>();
  const closes = new Set<number>();
  // Not preceded by a word char or `&` — skips URL fragments (`…/12#34`,
  // `page#2`) and HTML entities (`&#123;`) but keeps `#186/#187`;
  // capped at five digits so a hex colour like `#123456` isn't a ref.
  for (const m of text.matchAll(/(?<![\w&])#(\d{1,5})\b/g)) {
    refs.add(Number(m[1]));
  }
  for (const m of text.matchAll(
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)\b/gi,
  )) {
    closes.add(Number(m[1]));
  }
  const asc = (a: number, b: number) => a - b;
  return { refs: [...refs].sort(asc), closes: [...closes].sort(asc) };
}

export type CommitFact = {
  sha: string;
  subject: string;
  body?: string;
  date: string;
  /** Files the commit touched, when known. */
  files?: string[];
};

export type PullRequestFact = {
  number: number;
  title: string;
  body?: string;
  createdAt?: string;
  mergedAt?: string | null;
  files?: string[];
  closingIssues?: number[];
};

export type PostmortemSource =
  | { kind: "pr"; number: number }
  | { kind: "commit"; sha: string }
  | { kind: "range"; since: string; until?: string };

export type PostmortemFacts = {
  source: PostmortemSource;
  title: string;
  pullRequests: PullRequestFact[];
  commits: CommitFact[];
  /** Extra timeline rows the CLI knows about (e.g. deploy-related). */
  extraEvents?: TimelineEvent[];
  /** ISO timestamp, passed in so rendering stays deterministic. */
  generatedAt: string;
  /** Set when gh was unavailable and only git was consulted. */
  gitOnly?: boolean;
};

export function triggerCandidates(facts: PostmortemFacts): {
  commits: { sha: string; subject: string; files: string[] }[];
  prFiles: { pr: number; files: string[] }[];
} {
  const touches = (file: string) =>
    TRIGGER_PATHS.some((p) => file === p || file.startsWith(p));
  const commits = facts.commits
    .map((c) => ({
      sha: c.sha,
      subject: c.subject,
      files: (c.files ?? []).filter(touches),
    }))
    .filter((c) => c.files.length > 0);
  const prFiles = facts.pullRequests
    .map((pr) => ({ pr: pr.number, files: (pr.files ?? []).filter(touches) }))
    .filter((p) => p.files.length > 0);
  return { commits, prFiles };
}

export function timelineEvents(facts: PostmortemFacts): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const pr of facts.pullRequests) {
    if (pr.createdAt) {
      events.push({
        at: pr.createdAt,
        kind: "pr-opened",
        label: `PR #${pr.number} opened — ${pr.title}`,
        ref: `pr-${pr.number}-opened`,
      });
    }
    if (pr.mergedAt) {
      events.push({
        at: pr.mergedAt,
        kind: "pr-merged",
        label: `PR #${pr.number} merged to main (Railway deploys main on merge)`,
        ref: `pr-${pr.number}-merged`,
      });
    }
  }
  for (const c of facts.commits) {
    events.push({
      at: c.date,
      kind: "commit",
      label: `\`${c.sha.slice(0, 7)}\` ${c.subject}`,
      ref: c.sha,
    });
  }
  return [...events, ...(facts.extraEvents ?? [])];
}

/** `YYYY-MM-DD` of the earliest known event, for the filename. */
export function incidentDate(facts: PostmortemFacts): string {
  const rows = buildTimeline(timelineEvents(facts));
  return (rows[0]?.iso ?? facts.generatedAt).slice(0, 10);
}

function describeSource(source: PostmortemSource): string {
  switch (source.kind) {
    case "pr":
      return `PR #${source.number}`;
    case "commit":
      return `commit \`${source.sha.slice(0, 12)}\``;
    case "range":
      return `commits from ${source.since}${source.until ? ` to ${source.until}` : " onward"}`;
  }
}

function todo(prompt: string): string {
  return `<!-- TODO: ${prompt} -->`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

export function renderPostmortem(facts: PostmortemFacts): string {
  const allText = [
    facts.title,
    ...facts.pullRequests.flatMap((pr) => [
      pr.title,
      pr.body ?? "",
      ...(pr.files ?? []),
    ]),
    ...facts.commits.flatMap((c) => [
      c.subject,
      c.body ?? "",
      ...(c.files ?? []),
    ]),
  ].join("\n");
  const classification = classifyIncident(allText);
  const timeline = buildTimeline(timelineEvents(facts));
  const triggers = triggerCandidates(facts);

  const ownPrs = new Set(facts.pullRequests.map((pr) => pr.number));
  const linked = extractLinkedRefs(allText);
  const closing = new Set([
    ...linked.closes,
    ...facts.pullRequests.flatMap((pr) => pr.closingIssues ?? []),
  ]);
  const mentioned = linked.refs.filter(
    (n) => !ownPrs.has(n) && !closing.has(n),
  );

  const out: string[] = [];
  const h2 = (h: (typeof POSTMORTEM_HEADINGS)[number]) =>
    out.push("", `## ${h}`, "");

  out.push(`# Postmortem: ${facts.title}`);
  out.push("");
  out.push(
    `> **Draft.** Generated by \`npm run postmortem\` from ${describeSource(facts.source)} on ${facts.generatedAt.slice(0, 10)}. ` +
      "Facts below come from git" +
      (facts.gitOnly ? "" : " and GitHub") +
      "; every `TODO` needs a human. Blameless: describe systems and decisions, not people.",
  );
  if (facts.gitOnly) {
    out.push(">");
    out.push(
      "> Only git was consulted (a commit/range target, or gh was unavailable), so PR bodies, review timestamps and linked issues are missing — re-run against the PR number with gh authenticated, or fill them in by hand.",
    );
  }
  out.push("");
  out.push("**Status:** draft");
  out.push("");
  out.push(
    `**Suggested category:** ${classification.label} (heuristic — confirm against RUNBOOK.md's classification)`,
  );

  h2("Summary");
  for (const pr of facts.pullRequests) {
    out.push(
      `- PR #${pr.number}: ${pr.title}${pr.mergedAt ? ` (merged ${toUtcRow(new Date(pr.mergedAt))} UTC)` : ""}`,
    );
  }
  if (facts.pullRequests.length === 0) {
    for (const c of facts.commits.slice(0, 10)) {
      out.push(`- \`${c.sha.slice(0, 7)}\` ${c.subject}`);
    }
    if (facts.commits.length > 10) {
      out.push(
        `- …and ${facts.commits.length - 10} more commits (see Timeline)`,
      );
    }
  }
  out.push("");
  out.push(
    todo(
      "Two or three sentences: what broke, for how long, and how it was fixed.",
    ),
  );

  h2("Impact");
  out.push(
    todo(
      "Who/what was affected (prod, staging-qa, PR environments, iOS), how (502s, data loss, degraded), and for how long. Do not estimate — cite logs or say unknown.",
    ),
  );

  h2("Timeline (UTC)");
  if (timeline.length === 0) {
    out.push("_No timestamped events found._");
  } else {
    out.push("| When (UTC) | Event |");
    out.push("| --- | --- |");
    for (const row of timeline) {
      out.push(`| ${row.at} | ${escapeCell(row.label)} |`);
    }
  }
  out.push("");
  out.push(
    todo(
      "Add the times git can't see: first failing deploy, detection, start of mitigation, recovery verified (`railway deployment list`, `railway logs`).",
    ),
  );

  h2("Detection");
  out.push(
    todo(
      "How was this noticed — healthcheck, a 502 in the browser, a user, CI? How long between trigger and detection?",
    ),
  );

  h2("Root cause");
  out.push(
    todo(
      `Why it broke, in systems terms. Suggested category: ${classification.label}. Ask why the existing checks (CI, PR environments, staging-qa, MIGRATIONS.md review) didn't catch it.`,
    ),
  );

  h2("Trigger");
  if (triggers.commits.length === 0 && triggers.prFiles.length === 0) {
    out.push(
      `No gathered commit touched ${TRIGGER_PATHS.map((p) => `\`${p}\``).join(", ")}.`,
    );
  } else {
    out.push(
      `Candidates — changes touching ${TRIGGER_PATHS.map((p) => `\`${p}\``).join(", ")}:`,
    );
    out.push("");
    for (const c of triggers.commits) {
      out.push(
        `- \`${c.sha.slice(0, 7)}\` ${c.subject} — ${c.files.map((f) => `\`${f}\``).join(", ")}`,
      );
    }
    for (const p of triggers.prFiles) {
      out.push(`- PR #${p.pr} — ${p.files.map((f) => `\`${f}\``).join(", ")}`);
    }
  }
  out.push("");
  out.push(
    todo(
      "Confirm which change actually triggered the incident. A fix PR's own changes are listed here too — the trigger may be an earlier change it repairs.",
    ),
  );

  h2("Resolution and recovery");
  out.push(
    todo(
      "What was done to restore service (RUNBOOK.md steps used: start-command override, `railway ssh`, manual backfill, `prisma migrate resolve`…) and how recovery was verified.",
    ),
  );

  h2("What went well / what went poorly");
  out.push("**Went well**");
  out.push("");
  out.push(todo("e.g. /healthz kept the previous deployment serving."));
  out.push("");
  out.push("**Went poorly**");
  out.push("");
  out.push(
    todo(
      "e.g. a check that passed only because every non-prod database is empty.",
    ),
  );

  h2("Action items");
  out.push("| Action | Owner | Issue | Status |");
  out.push("| --- | --- | --- | --- |");
  out.push("|  |  |  |  |");
  out.push("");
  out.push(
    todo(
      'One row per follow-up, each with an issue link. Prefer changes to systems (checks, docs, defaults) over "be more careful".',
    ),
  );

  h2("Related PRs, commits and issues");
  for (const pr of facts.pullRequests)
    out.push(`- PR #${pr.number} — ${pr.title}`);
  for (const c of facts.commits)
    out.push(`- \`${c.sha.slice(0, 7)}\` ${c.subject}`);
  if (closing.size > 0) {
    out.push(
      `- Closes: ${[...closing]
        .sort((a, b) => a - b)
        .map((n) => `#${n}`)
        .join(", ")}`,
    );
  }
  if (mentioned.length > 0) {
    out.push(`- Also mentioned: ${mentioned.map((n) => `#${n}`).join(", ")}`);
  }
  out.push(
    "- [RUNBOOK.md](../../RUNBOOK.md), [MIGRATIONS.md](../../MIGRATIONS.md)",
  );

  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}
