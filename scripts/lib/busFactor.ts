/**
 * Bus-factor / code-ownership analysis over git history (`npm run
 * bus-factor`, scripts/busFactor.ts). Everything here is pure — the CLI does
 * the `git` calls and hands the raw output in — so it's testable from
 * fixture strings the same way app/domain is.
 *
 * Ownership is lines changed (added + deleted) per author per file, counted
 * only for files still tracked and not generated/vendored. An area's bus
 * factor is the classic greedy one: the fewest authors who together account
 * for more than `threshold` (default half) of its lines changed.
 *
 * Author identity is whatever `%aN`/`%aE` resolve to — i.e. after .mailmap.
 * Without the repo's .mailmap one person shows up as several owners and
 * every bus factor reads higher than it really is.
 */

export type FileChange = {
  path: string;
  added: number;
  deleted: number;
  binary: boolean;
  /** Set when git reported this entry as a rename (`{old => new}`). */
  renamedFrom?: string;
};

export type Commit = {
  sha: string;
  author: string;
  email: string;
  coAuthors: string[];
  files: FileChange[];
};

/** The `git log` format parseNumstatLog expects — one header line per commit. */
export const NUMSTAT_LOG_FORMAT =
  "--%x09%H%x09%aN%x09%aE%x09%(trailers:key=Co-Authored-By,valueonly,separator=%x2C)";

const HEADER_PREFIX = "--\t";

/**
 * Resolves git's rename notation to `[from, to]`. Handles the bare
 * `old => new` form and the braced `dir/{old => new}/rest` form, including
 * an empty side (`a/{ => sub}/b`), which leaves a doubled slash to collapse.
 */
export function parseRenamePath(
  raw: string,
): { from: string; to: string } | null {
  const braced = raw.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braced) {
    const [, pre, from, to, post] = braced;
    const clean = (p: string) => p.replace(/\/{2,}/g, "/").replace(/^\//, "");
    return { from: clean(pre + from + post), to: clean(pre + to + post) };
  }
  const bare = raw.match(/^(.*) => (.*)$/);
  if (bare) return { from: bare[1], to: bare[2] };
  return null;
}

/** Parses `git log --numstat --format=NUMSTAT_LOG_FORMAT` output. */
export function parseNumstatLog(raw: string): Commit[] {
  const commits: Commit[] = [];
  let current: Commit | null = null;

  for (const line of raw.split("\n")) {
    if (line.startsWith(HEADER_PREFIX)) {
      const [, sha, author, email, trailers = ""] = line.split("\t");
      current = {
        sha,
        author,
        email,
        coAuthors: trailers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        files: [],
      };
      commits.push(current);
      continue;
    }
    if (!current || line.trim() === "") continue;

    const [addedRaw, deletedRaw, ...pathParts] = line.split("\t");
    const rawPath = pathParts.join("\t");
    if (!rawPath) continue;
    const binary = addedRaw === "-" || deletedRaw === "-";
    const rename = parseRenamePath(rawPath);
    current.files.push({
      path: rename ? rename.to : rawPath,
      added: binary ? 0 : Number(addedRaw),
      deleted: binary ? 0 : Number(deletedRaw),
      binary,
      ...(rename ? { renamedFrom: rename.from } : {}),
    });
  }
  return commits;
}

/** True for a `Co-Authored-By` value that names Claude/Anthropic. */
export function isAiCoAuthor(coAuthor: string): boolean {
  return /claude|@anthropic\.com/i.test(coAuthor);
}

export function isAiAssisted(commit: Commit): boolean {
  return commit.coAuthors.some(isAiCoAuthor);
}

// Generated or vendored output, and binary assets: nobody "owns" these in
// the sense a bus factor cares about, and lockfile churn alone would swamp
// every real file's numbers. design/ is the Figma sync mirror (see
// .prettierignore), openapi/ is written by `npm run generate:openapi`.
const EXCLUDED_SEGMENTS = new Set([
  "node_modules",
  "generated",
  "build",
  "dist",
]);
const EXCLUDED_PREFIXES = ["design/", "openapi/"];
const EXCLUDED_BASENAMES = new Set(["package-lock.json"]);
const EXCLUDED_EXTENSIONS =
  /\.(ttf|otf|woff2?|eot|png|jpe?g|gif|webp|ico|pdf|epub|zip)$/i;

export function isExcludedPath(path: string): boolean {
  const segments = path.split("/");
  const basename = segments[segments.length - 1];
  return (
    segments.slice(0, -1).some((s) => EXCLUDED_SEGMENTS.has(s)) ||
    EXCLUDED_PREFIXES.some((p) => path.startsWith(p)) ||
    EXCLUDED_BASENAMES.has(basename) ||
    EXCLUDED_EXTENSIONS.test(basename)
  );
}

export type Ownership = {
  /** Lines changed (added + deleted) across all authors. */
  total: number;
  /** Lines changed per author. */
  byAuthor: Record<string, number>;
  /** Lines changed in commits carrying a Claude Co-Authored-By trailer. */
  aiAssistedLines: number;
  commits: Set<string>;
  aiAssistedCommits: Set<string>;
};

export type FileOwnership = Ownership & { path: string };

function emptyOwnership(): Ownership {
  return {
    total: 0,
    byAuthor: {},
    aiAssistedLines: 0,
    commits: new Set(),
    aiAssistedCommits: new Set(),
  };
}

function mergeInto(target: Ownership, source: Ownership): void {
  target.total += source.total;
  target.aiAssistedLines += source.aiAssistedLines;
  for (const [author, lines] of Object.entries(source.byAuthor)) {
    target.byAuthor[author] = (target.byAuthor[author] ?? 0) + lines;
  }
  for (const sha of source.commits) target.commits.add(sha);
  for (const sha of source.aiAssistedCommits) target.aiAssistedCommits.add(sha);
}

/**
 * Sums lines changed per author for each live, non-excluded file.
 * `commits` is in `git log` order (newest first). History recorded under a
 * file's old name is carried forward through later renames, unless the old
 * name is itself a live file again (a new file reusing the path).
 */
export function ownershipByFile(
  commits: Commit[],
  liveFiles: Iterable<string>,
): FileOwnership[] {
  const live = new Set(liveFiles);
  const renamedTo = new Map<string, string>();
  for (const commit of [...commits].reverse()) {
    for (const f of commit.files) {
      if (f.renamedFrom && f.renamedFrom !== f.path) {
        renamedTo.set(f.renamedFrom, f.path);
      }
    }
  }
  const resolve = (path: string): string => {
    const seen = new Set<string>();
    let p = path;
    while (!live.has(p) && renamedTo.has(p) && !seen.has(p)) {
      seen.add(p);
      p = renamedTo.get(p)!;
    }
    return p;
  };

  const byPath = new Map<string, FileOwnership>();
  for (const commit of commits) {
    const ai = isAiAssisted(commit);
    for (const f of commit.files) {
      const path = resolve(f.path);
      if (!live.has(path) || isExcludedPath(path)) continue;
      let entry = byPath.get(path);
      if (!entry) {
        entry = { path, ...emptyOwnership() };
        byPath.set(path, entry);
      }
      const lines = f.added + f.deleted;
      entry.total += lines;
      entry.byAuthor[commit.author] =
        (entry.byAuthor[commit.author] ?? 0) + lines;
      entry.commits.add(commit.sha);
      if (ai) {
        entry.aiAssistedLines += lines;
        entry.aiAssistedCommits.add(commit.sha);
      }
    }
  }
  return [...byPath.values()];
}

/** The area a path belongs to: its first `depth` directories, or "(root)". */
export function areaOf(path: string, depth: number): string {
  const dirs = path.split("/").slice(0, -1);
  return dirs.length === 0 ? "(root)" : dirs.slice(0, depth).join("/");
}

export type AreaOwnership = Ownership & { area: string; files: number };

export function rollupByArea(
  files: FileOwnership[],
  depth: number,
): AreaOwnership[] {
  const areas = new Map<string, AreaOwnership>();
  for (const file of files) {
    const area = areaOf(file.path, depth);
    let entry = areas.get(area);
    if (!entry) {
      entry = { area, files: 0, ...emptyOwnership() };
      areas.set(area, entry);
    }
    entry.files += 1;
    mergeInto(entry, file);
  }
  return [...areas.values()].sort((a, b) => b.total - a.total);
}

export type BusFactor = {
  /** Fewest authors whose combined share exceeds the threshold; 0 if no history. */
  busFactor: number;
  topOwner: string | null;
  topShare: number;
  authors: number;
};

export function busFactor(
  ownership: Pick<Ownership, "total" | "byAuthor">,
  threshold = 0.5,
): BusFactor {
  const ranked = Object.entries(ownership.byAuthor).sort((a, b) => b[1] - a[1]);
  if (ownership.total <= 0 || ranked.length === 0) {
    return { busFactor: 0, topOwner: null, topShare: 0, authors: 0 };
  }
  let covered = 0;
  let count = 0;
  for (const [, lines] of ranked) {
    covered += lines;
    count += 1;
    if (covered / ownership.total > threshold) break;
  }
  return {
    busFactor: count,
    topOwner: ranked[0][0],
    topShare: ranked[0][1] / ownership.total,
    authors: ranked.length,
  };
}

export type AiAssistShare = {
  commits: number;
  aiAssistedCommits: number;
  commitShare: number;
  lineShare: number;
};

/** Share of commits and lines changed that carry a Claude co-author. */
export function aiAssistShare(ownership: Ownership): AiAssistShare {
  const commits = ownership.commits.size;
  const aiAssistedCommits = ownership.aiAssistedCommits.size;
  return {
    commits,
    aiAssistedCommits,
    commitShare: commits === 0 ? 0 : aiAssistedCommits / commits,
    lineShare:
      ownership.total === 0 ? 0 : ownership.aiAssistedLines / ownership.total,
  };
}

export type AnalyzeOptions = {
  depth: number;
  threshold: number;
  /** How many single-owner files to list, largest first. */
  topFiles?: number;
  since?: string;
};

type Summary = BusFactor & { lines: number; ai: AiAssistShare };

export type BusFactorReport = {
  options: AnalyzeOptions;
  historyCommits: number;
  historyAiAssistedCommits: number;
  authors: string[];
  overall: Summary & { files: number };
  areas: (Summary & { area: string; files: number })[];
  highestRisk: (Summary & { path: string })[];
};

function summarize(o: Ownership, threshold: number): Summary {
  return { ...busFactor(o, threshold), lines: o.total, ai: aiAssistShare(o) };
}

export function analyze(
  commits: Commit[],
  liveFiles: Iterable<string>,
  options: AnalyzeOptions,
): BusFactorReport {
  const files = ownershipByFile(commits, liveFiles);
  const overall = emptyOwnership();
  for (const f of files) mergeInto(overall, f);

  const highestRisk = files
    .map((f) => ({ path: f.path, ...summarize(f, options.threshold) }))
    .filter((f) => f.busFactor === 1)
    .sort((a, b) => b.lines - a.lines)
    .slice(0, options.topFiles ?? 10);

  return {
    options,
    historyCommits: commits.length,
    historyAiAssistedCommits: commits.filter(isAiAssisted).length,
    authors: [...new Set(commits.map((c) => c.author))].sort(),
    overall: { files: files.length, ...summarize(overall, options.threshold) },
    areas: rollupByArea(files, options.depth).map((a) => ({
      area: a.area,
      files: a.files,
      ...summarize(a, options.threshold),
    })),
    highestRisk,
  };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function formatReport(
  report: BusFactorReport,
  { format }: { format: "markdown" | "json" },
): string {
  if (format === "json") return JSON.stringify(report, null, 2);

  const { options, overall } = report;
  const lines: string[] = [
    "# Bus-factor report",
    "",
    `History: ${report.historyCommits} commits` +
      (options.since ? ` since ${options.since}` : "") +
      `, ${report.historyAiAssistedCommits} with a Claude co-author. ` +
      `Authors (after .mailmap): ${report.authors.join(", ") || "none"}.`,
    "",
    `Overall bus factor: **${overall.busFactor}** across ${overall.files} live files ` +
      `(${overall.lines} lines changed; top owner ${overall.topOwner ?? "—"} at ${pct(overall.topShare)}; ` +
      `${pct(overall.ai.lineShare)} of lines in AI-assisted commits).`,
    "",
    `## By area (depth ${options.depth}, threshold ${options.threshold})`,
    "",
    "| Area | Files | Lines changed | Top owner | Share | Bus factor | AI-assisted lines | AI-assisted commits |",
    "| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |",
    ...report.areas.map(
      (a) =>
        `| ${a.area} | ${a.files} | ${a.lines} | ${a.topOwner ?? "—"} | ${pct(a.topShare)} | ${a.busFactor} | ` +
        `${pct(a.ai.lineShare)} | ${a.ai.aiAssistedCommits}/${a.ai.commits} |`,
    ),
    "",
    "## Highest risk: largest single-owner files",
    "",
  ];
  if (report.highestRisk.length === 0) {
    lines.push("None.");
  } else {
    lines.push(
      "| File | Lines changed | Owner | AI-assisted lines |",
      "| --- | ---: | --- | ---: |",
      ...report.highestRisk.map(
        (f) =>
          `| ${f.path} | ${f.lines} | ${f.topOwner ?? "—"} | ${pct(f.ai.lineShare)} |`,
      ),
    );
  }
  return lines.join("\n") + "\n";
}
