import path from "node:path";

/**
 * Pure helpers behind scripts/profileServer.ts, split out so the stats
 * math and the DATABASE_URL guard are testable without a seeded database
 * (the profile script itself does real I/O at import time's worth of
 * distance — this module does none).
 */

/**
 * Nearest-rank percentile over an unsorted sample: the smallest value with
 * at least `p` percent of the sample at or below it. Nearest-rank rather
 * than interpolated so every reported number is one a real call actually
 * took — with 20–30 runs, an interpolated p95 is a value nothing measured.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  if (p <= 0) return Math.min(...values);
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

export type Sample = { ms: number; bytes: number; queries: number };

export type Summary = {
  runs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  /** Payload size is deterministic per call, but report the max in case it isn't. */
  bytes: number;
  /** Max SQL statements any one call issued — the N+1 signal. */
  queries: number;
};

export function summarize(samples: readonly Sample[]): Summary {
  const ms = samples.map((s) => s.ms);
  return {
    runs: samples.length,
    p50Ms: percentile(ms, 50),
    p95Ms: percentile(ms, 95),
    maxMs: samples.length ? Math.max(...ms) : Number.NaN,
    bytes: samples.length ? Math.max(...samples.map((s) => s.bytes)) : 0,
    queries: samples.length ? Math.max(...samples.map((s) => s.queries)) : 0,
  };
}

/**
 * Rough N+1 flag: a fetch whose statement count grows with the data it
 * returns, rather than staying a small constant. Every loader here is
 * written as a fixed handful of batched queries, so anything past this is
 * worth a look, not necessarily a bug.
 */
export const N_PLUS_ONE_QUERY_THRESHOLD = 10;

/**
 * The profile only ever runs against this checkout's own SQLite file —
 * AGENTS.md's worktree-isolation rule, enforced rather than trusted. A
 * relative `file:` URL resolving inside `cwd`, nothing else: an absolute
 * path or a `../` escape is exactly how a worktree ends up pointing at the
 * primary checkout's dev.db. Returns the resolved path, throws otherwise.
 */
export function assertLocalSqliteUrl(
  url: string | undefined,
  cwd: string,
): string {
  if (!url)
    throw new Error("DATABASE_URL is unset — copy .env.example to .env first.");
  if (!url.startsWith("file:")) {
    throw new Error(`DATABASE_URL must be a file: URL, got ${url}`);
  }
  // The adapter hands everything after `file:` to better-sqlite3 verbatim,
  // so `file:./dev.db?mode=ro` opens a file literally named `dev.db?mode=ro`
  // — not the path this guard would otherwise have checked.
  if (url.includes("?")) {
    throw new Error(
      `DATABASE_URL must not carry a ?query (better-sqlite3 treats it as part of the filename), got ${url}`,
    );
  }
  const filePath = url.slice("file:".length);
  if (filePath === "" || path.isAbsolute(filePath)) {
    throw new Error(
      `DATABASE_URL must be a *relative* file: path (e.g. file:./dev.db), got ${url}`,
    );
  }
  const resolved = path.resolve(cwd, filePath);
  const relative = path.relative(cwd, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `DATABASE_URL ${url} resolves to ${resolved}, outside ${cwd} — refusing to profile another checkout's database.`,
    );
  }
  return resolved;
}

/** Statements that would make a "read-only" profile not read-only. */
export function isWriteStatement(sql: string): boolean {
  return /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i.test(sql);
}

export const DEFAULT_PROFILE_RUNS = 20;

/** CLI args for profileServer.ts: `--runs N` or `--runs=N`, and `--json`. */
export function parseProfileArgs(argv: readonly string[]): {
  runs: number;
  json: boolean;
} {
  let runs = DEFAULT_PROFILE_RUNS;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--runs") runs = Number(argv[++i]);
    else if (arg.startsWith("--runs="))
      runs = Number(arg.slice("--runs=".length));
    else if (arg === "--json") json = true;
  }
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`--runs must be a positive integer, got ${runs}`);
  }
  return { runs, json };
}
