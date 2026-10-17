// Knowledge-silo detection over git history. Everything here is a pure
// function of a `git log` string (plus a "now" and a list of tracked
// files) — no child processes, no filesystem, no network. The git call
// itself lives in scripts/knowledgeSilo.ts, which is the only impure part.
//
// The model: a file's knowledge belongs to whoever has churned its lines.
// Files are bucketed into areas (by default the first two path segments),
// and each area gets an ownership distribution over its human authors. An
// area is a silo when that distribution is concentrated enough that losing
// one person would lose most of what's known about it.

/** The `--format` this module's parser expects: a record separator, then
 * hash, author name, author email and author timestamp, unit-separated. */
export const GIT_LOG_FORMAT = "%x1e%H%x1f%aN%x1f%aE%x1f%at";

export interface FileChange {
  path: string;
  added: number;
  deleted: number;
  binary: boolean;
}

export interface Commit {
  hash: string;
  authorName: string;
  authorEmail: string;
  /** Unix seconds. */
  timestamp: number;
  files: FileChange[];
}

/** Collapses numstat's rename notation to the post-rename path:
 * `app/{old => new}/x.ts` → `app/new/x.ts`, `old.ts => new.ts` → `new.ts`. */
export function resolveRenamePath(path: string): string {
  const braced = path.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braced) {
    const [, prefix, , to, suffix] = braced;
    // `{a => }` leaves a doubled slash behind (`dir//file`).
    return `${prefix}${to}${suffix}`.replace(/\/{2,}/g, "/");
  }
  const bare = path.split(" => ");
  return bare.length === 2 ? bare[1] : path;
}

/** Parses `git log --numstat --format=<GIT_LOG_FORMAT>` output. Binary rows
 * (`-\t-\tpath`) count as a touch with zero lines. */
export function parseGitLog(raw: string): Commit[] {
  const commits: Commit[] = [];
  for (const record of raw.split("\x1e")) {
    if (!record.trim()) continue;
    const [header, ...rest] = record.split("\n");
    const [hash, authorName, authorEmail, at] = header.split("\x1f");
    if (!hash || at === undefined) continue;
    const files: FileChange[] = [];
    for (const line of rest) {
      const m = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/);
      if (!m) continue;
      const binary = m[1] === "-" && m[2] === "-";
      files.push({
        path: resolveRenamePath(m[3]),
        added: binary ? 0 : Number(m[1]),
        deleted: binary ? 0 : Number(m[2]),
        binary,
      });
    }
    commits.push({
      hash,
      authorName,
      authorEmail,
      timestamp: Number(at),
      files,
    });
  }
  return commits;
}

export type AuthorKind = "human" | "bot" | "agent";

/** Bots and coding agents are reported separately — a commit by
 * `posthog[bot]` or by Claude isn't knowledge a person carries around. */
export function classifyAuthor(name: string, email: string): AuthorKind {
  const e = email.toLowerCase();
  const n = name.toLowerCase();
  if (e.includes("[bot]") || n.endsWith("[bot]") || n.endsWith("-bot")) {
    return "bot";
  }
  if (
    e === "noreply@anthropic.com" ||
    e === "noreply@openai.com" ||
    e.endsWith("@cursor.com")
  ) {
    return "agent";
  }
  return "human";
}

/** Paths that are generated, vendored or lockfiles — churn there says
 * nothing about who understands the code. */
export const DEFAULT_EXCLUDES: RegExp[] = [
  /(^|\/)generated\//,
  /(^|\/)build\//,
  /(^|\/)dist\//,
  /(^|\/)storybook-static\//,
  /^public\/fonts\//,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Package\.resolved)$/,
  /^prisma\/migrations\/.*\.sql$/,
  /^openapi\//,
  /^design\//,
];

export const ROOT_AREA = "(root files)";

/** Buckets a path into an area by its first `depth` directory segments
 * (never the filename, so `scripts/release.ts` is `scripts`), or returns
 * null when the path is excluded. Top-level files share one area. */
export function groupByArea(
  path: string,
  depth = 2,
  excludes: RegExp[] = DEFAULT_EXCLUDES,
): string | null {
  if (excludes.some((re) => re.test(path))) return null;
  const dirs = path.split("/").slice(0, -1);
  if (dirs.length === 0) return ROOT_AREA;
  return dirs.slice(0, Math.max(1, depth)).join("/");
}

export interface AnalyzeOptions {
  depth?: number;
  excludes?: RegExp[];
  /** Unix seconds; the reference point for staleness and decay. */
  now: number;
  halfLifeDays?: number;
  minCommits?: number;
}

export interface AuthorShare {
  name: string;
  email: string;
  churn: number;
  commits: number;
  /** Share of the area's human churn, 0–1. */
  share: number;
  /** Share after recency decay, 0–1. */
  weightedShare: number;
}

export interface AreaStats {
  area: string;
  commits: number;
  churn: number;
  humanAuthors: number;
  /** Commits by bots/agents, kept out of ownership. */
  nonHumanCommits: number;
  topAuthor: AuthorShare | null;
  authors: AuthorShare[];
  busFactor: number;
  /** Unix seconds of the latest commit touching the area. */
  lastChange: number;
  /** Decayed churn ÷ raw churn: how much of what's known is recent. */
  freshness: number;
}

const DAY = 86_400;

/** The smallest number of authors whose combined share reaches 50% — the
 * usual truck-factor heuristic. 0 when there are no authors at all. */
export function busFactor(shares: number[]): number {
  const sorted = [...shares].sort((a, b) => b - a);
  const total = sorted.reduce((s, x) => s + x, 0);
  if (total <= 0) return 0;
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i];
    if (acc / total >= 0.5 - 1e-9) return i + 1;
  }
  return sorted.length;
}

export function decayWeight(ageSeconds: number, halfLifeDays: number): number {
  if (halfLifeDays <= 0) return 1;
  return Math.pow(0.5, Math.max(0, ageSeconds) / (halfLifeDays * DAY));
}

/** Authors are keyed by lowercased email, so commits git's `.mailmap`
 * has already canonicalised (via `%aN`/`%aE`) merge here too. */
export function computeAreaStats(
  commits: Commit[],
  opts: AnalyzeOptions,
): AreaStats[] {
  const depth = opts.depth ?? 2;
  const excludes = opts.excludes ?? DEFAULT_EXCLUDES;
  const halfLife = opts.halfLifeDays ?? 180;
  const minCommits = opts.minCommits ?? 1;

  interface Acc {
    commits: Set<string>;
    nonHuman: Set<string>;
    lastChange: number;
    authors: Map<
      string,
      {
        name: string;
        email: string;
        churn: number;
        weighted: number;
        commits: Set<string>;
      }
    >;
  }
  const areas = new Map<string, Acc>();

  for (const c of commits) {
    const kind = classifyAuthor(c.authorName, c.authorEmail);
    const weight = decayWeight(opts.now - c.timestamp, halfLife);
    for (const f of c.files) {
      const area = groupByArea(f.path, depth, excludes);
      if (!area) continue;
      let acc = areas.get(area);
      if (!acc) {
        acc = {
          commits: new Set(),
          nonHuman: new Set(),
          lastChange: 0,
          authors: new Map(),
        };
        areas.set(area, acc);
      }
      acc.commits.add(c.hash);
      acc.lastChange = Math.max(acc.lastChange, c.timestamp);
      if (kind !== "human") {
        acc.nonHuman.add(c.hash);
        continue;
      }
      const key = c.authorEmail.toLowerCase();
      let a = acc.authors.get(key);
      if (!a) {
        a = {
          name: c.authorName,
          email: c.authorEmail,
          churn: 0,
          weighted: 0,
          commits: new Set(),
        };
        acc.authors.set(key, a);
      }
      // A binary touch still counts as one unit, so an area made only of
      // binaries (fonts, images) has a nonzero ownership distribution.
      const lines = f.binary ? 1 : f.added + f.deleted;
      a.churn += lines;
      a.weighted += lines * weight;
      a.commits.add(c.hash);
    }
  }

  const stats: AreaStats[] = [];
  for (const [area, acc] of areas) {
    if (acc.commits.size < minCommits) continue;
    const list = [...acc.authors.values()];
    const churn = list.reduce((s, a) => s + a.churn, 0);
    const weighted = list.reduce((s, a) => s + a.weighted, 0);
    const authors: AuthorShare[] = list
      .map((a) => ({
        name: a.name,
        email: a.email,
        churn: a.churn,
        commits: a.commits.size,
        share: churn > 0 ? a.churn / churn : 0,
        weightedShare: weighted > 0 ? a.weighted / weighted : 0,
      }))
      .sort((x, y) => y.churn - x.churn);
    stats.push({
      area,
      commits: acc.commits.size,
      churn,
      humanAuthors: authors.length,
      nonHumanCommits: acc.nonHuman.size,
      topAuthor: authors[0] ?? null,
      authors,
      busFactor: busFactor(authors.map((a) => a.churn)),
      lastChange: acc.lastChange,
      freshness: churn > 0 ? weighted / churn : 0,
    });
  }
  return stats.sort((a, b) => b.churn - a.churn);
}

export interface SiloThresholds {
  /** Top-author share at or above which an area is concentrated. */
  concentration?: number;
  /** Days untouched after which a sole-owned area is a stale silo. */
  staleDays?: number;
  now: number;
}

export type SiloReason = "sole-author" | "concentrated" | "bus-factor-1";

export interface Silo {
  stats: AreaStats;
  reasons: SiloReason[];
  stale: boolean;
  daysSinceChange: number;
  /** Churn × concentration — big, concentrated areas rank first. */
  severity: number;
}

export function detectSilos(
  stats: AreaStats[],
  thresholds: SiloThresholds,
): Silo[] {
  const concentration = thresholds.concentration ?? 0.8;
  const staleDays = thresholds.staleDays ?? 180;
  const silos: Silo[] = [];
  for (const s of stats) {
    if (!s.topAuthor) continue;
    const reasons: SiloReason[] = [];
    if (s.humanAuthors === 1) reasons.push("sole-author");
    if (s.topAuthor.share >= concentration) reasons.push("concentrated");
    if (s.busFactor === 1) reasons.push("bus-factor-1");
    if (reasons.length === 0) continue;
    const daysSinceChange = Math.floor((thresholds.now - s.lastChange) / DAY);
    silos.push({
      stats: s,
      reasons,
      stale: s.humanAuthors === 1 && daysSinceChange > staleDays,
      daysSinceChange,
      severity: s.churn * s.topAuthor.share,
    });
  }
  return silos.sort((a, b) => b.severity - a.severity);
}

export interface Report {
  generatedAt: number;
  options: {
    since?: string;
    depth: number;
    minCommits: number;
    halfLifeDays: number;
    concentration: number;
    staleDays: number;
  };
  totals: {
    commits: number;
    humanAuthors: { name: string; email: string; commits: number }[];
    nonHumanAuthors: {
      name: string;
      email: string;
      kind: AuthorKind;
      commits: number;
    }[];
  };
  areas: AreaStats[];
  silos: Silo[];
  /** Areas containing a README or other tracked Markdown doc. */
  documentedAreas: string[];
}

/** Rolls up author totals for the report header. */
export function summarizeAuthors(commits: Commit[]): Report["totals"] {
  const byKey = new Map<
    string,
    { name: string; email: string; kind: AuthorKind; commits: number }
  >();
  for (const c of commits) {
    const key = c.authorEmail.toLowerCase();
    const existing = byKey.get(key);
    if (existing) existing.commits++;
    else
      byKey.set(key, {
        name: c.authorName,
        email: c.authorEmail,
        kind: classifyAuthor(c.authorName, c.authorEmail),
        commits: 1,
      });
  }
  const all = [...byKey.values()].sort((a, b) => b.commits - a.commits);
  return {
    commits: commits.length,
    humanAuthors: all
      .filter((a) => a.kind === "human")
      .map(({ name, email, commits }) => ({ name, email, commits })),
    nonHumanAuthors: all.filter((a) => a.kind !== "human"),
  };
}

/** Which of `areas` have a tracked Markdown doc in them, or in the area
 * directly above (`ios/README.md` covers `ios/Sources`). Root-level docs
 * don't count — they'd mark everything documented. */
export function findDocumentedAreas(
  areas: string[],
  trackedFiles: string[],
  depth = 2,
): string[] {
  const docAreas = new Set(
    trackedFiles
      .filter((f) => /\.md$/i.test(f))
      .map((f) => groupByArea(f, depth, []))
      .filter((a) => a !== null && a !== ROOT_AREA),
  );
  return areas
    .filter(
      (area) =>
        docAreas.has(area) ||
        (area.includes("/") &&
          docAreas.has(area.slice(0, area.lastIndexOf("/")))),
    )
    .sort();
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function isoDate(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

export function renderMarkdown(report: Report): string {
  const lines: string[] = [];
  const o = report.options;
  lines.push("## Contributors", "");
  lines.push(
    `${report.totals.commits} non-merge commits${o.since ? ` since ${o.since}` : ""}.`,
    "",
  );
  for (const a of report.totals.humanAuthors) {
    lines.push(`- ${a.name} <${a.email}> — ${a.commits} commits`);
  }
  for (const a of report.totals.nonHumanAuthors) {
    lines.push(
      `- ${a.name} <${a.email}> — ${a.commits} commits (${a.kind}, excluded from ownership)`,
    );
  }
  lines.push("");
  lines.push(
    "## Silos, ranked",
    "",
    `Flagged when an area has one human author, a top author at or above ${pct(o.concentration)} of churn, or a bus factor of 1. ` +
      `Ranked by churn × top-author share. "Stale" means sole-owned and untouched for over ${o.staleDays} days. ` +
      `"Recent share" decays each commit with a ${o.halfLifeDays}-day half-life; "freshness" is how much of an area's churn survives that decay.`,
    "",
  );
  const documented = new Set(report.documentedAreas);
  if (report.silos.length === 0) {
    lines.push("No silos found.", "");
  } else {
    lines.push(
      "| # | Area | Commits | Churn | Humans | Bus factor | Top author | Share | Recent share | Freshness | Last change | Docs in area | Flags |",
      "| -: | --- | -: | -: | -: | -: | --- | -: | -: | -: | --- | --- | --- |",
    );
    report.silos.forEach((s, i) => {
      const a = s.stats;
      const flags = [...s.reasons, ...(s.stale ? ["stale"] : [])].join(", ");
      lines.push(
        `| ${i + 1} | \`${a.area}\` | ${a.commits} | ${a.churn} | ${a.humanAuthors} | ${a.busFactor} | ${a.topAuthor?.name ?? "—"} | ${pct(a.topAuthor?.share ?? 0)} | ${pct(a.topAuthor?.weightedShare ?? 0)} | ${pct(a.freshness)} | ${isoDate(a.lastChange)} | ${documented.has(a.area) ? "yes" : "—"} | ${flags} |`,
      );
    });
    lines.push("");
  }
  const shared = report.areas.filter(
    (a) => !report.silos.some((s) => s.stats.area === a.area),
  );
  if (shared.length > 0) {
    lines.push("## Shared areas", "");
    for (const a of shared) {
      lines.push(
        `- \`${a.area}\` — ${a.humanAuthors} authors, bus factor ${a.busFactor}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function renderJson(report: Report): string {
  return JSON.stringify(report, null, 2) + "\n";
}
