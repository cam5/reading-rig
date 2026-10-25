import { describe, expect, it } from "vitest";
import {
  assertLocalSqliteUrl,
  isWriteStatement,
  parseProfileArgs,
  percentile,
  summarize,
} from "./perfStats";

describe("percentile", () => {
  it("uses nearest-rank, so every result is a measured value", () => {
    const values = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 95)).toBe(10);
    expect(percentile(values, 100)).toBe(10);
    expect(percentile(values, 0)).toBe(1);
  });

  it("handles a single sample and an empty one", () => {
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 50)).toBeNaN();
  });

  it("doesn't mutate its input", () => {
    const values = [3, 1, 2];
    percentile(values, 50);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("summarize", () => {
  it("reports p50/p95/max latency and the max bytes/queries", () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({
      ms: i + 1,
      bytes: 100,
      queries: i === 7 ? 4 : 3,
    }));
    expect(summarize(samples)).toEqual({
      runs: 20,
      p50Ms: 10,
      p95Ms: 19,
      maxMs: 20,
      bytes: 100,
      queries: 4,
    });
  });
});

describe("assertLocalSqliteUrl", () => {
  const cwd = "/work/reading-rig-perf-profile";

  it("accepts a relative file: URL inside cwd", () => {
    expect(assertLocalSqliteUrl("file:./dev.db", cwd)).toBe(`${cwd}/dev.db`);
    expect(assertLocalSqliteUrl("file:prisma/dev.db", cwd)).toBe(
      `${cwd}/prisma/dev.db`,
    );
  });

  it("refuses anything that could reach another checkout's database", () => {
    expect(() => assertLocalSqliteUrl(undefined, cwd)).toThrow(/unset/);
    expect(() => assertLocalSqliteUrl("postgres://x", cwd)).toThrow(/file:/);
    expect(() =>
      assertLocalSqliteUrl("file:/work/reading-rig/dev.db", cwd),
    ).toThrow(/relative/);
    expect(() =>
      assertLocalSqliteUrl("file:../reading-rig/dev.db", cwd),
    ).toThrow(/outside/);
  });

  it("refuses a ?query, which better-sqlite3 would treat as part of the filename", () => {
    expect(() => assertLocalSqliteUrl("file:./dev.db?mode=ro", cwd)).toThrow(
      /\?query/,
    );
    expect(() => assertLocalSqliteUrl("file:./dev.db?", cwd)).toThrow(
      /\?query/,
    );
  });
});

describe("parseProfileArgs", () => {
  it("defaults to 20 runs, no JSON", () => {
    expect(parseProfileArgs([])).toEqual({ runs: 20, json: false });
  });

  it("accepts both --runs N and --runs=N", () => {
    expect(parseProfileArgs(["--runs", "30"])).toEqual({
      runs: 30,
      json: false,
    });
    expect(parseProfileArgs(["--runs=30", "--json"])).toEqual({
      runs: 30,
      json: true,
    });
  });

  it("rejects a non-positive or non-integer run count", () => {
    expect(() => parseProfileArgs(["--runs=0"])).toThrow(/positive integer/);
    expect(() => parseProfileArgs(["--runs="])).toThrow(/positive integer/);
    expect(() => parseProfileArgs(["--runs", "abc"])).toThrow(
      /positive integer/,
    );
    expect(() => parseProfileArgs(["--runs"])).toThrow(/positive integer/);
  });
});

describe("isWriteStatement", () => {
  it("flags writes, not reads", () => {
    expect(isWriteStatement('INSERT INTO "Entry" VALUES (1)')).toBe(true);
    expect(isWriteStatement("  update Work set title = 'x'")).toBe(true);
    expect(isWriteStatement('SELECT "id" FROM "Work"')).toBe(false);
    expect(isWriteStatement("PRAGMA query_only = ON")).toBe(false);
  });
});
