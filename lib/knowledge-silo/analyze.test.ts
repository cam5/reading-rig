import { describe, expect, it } from "vitest";
import {
  ROOT_AREA,
  busFactor,
  classifyAuthor,
  computeAreaStats,
  decayWeight,
  detectSilos,
  findDocumentedAreas,
  groupByArea,
  parseGitLog,
  renderJson,
  renderMarkdown,
  resolveRenamePath,
  summarizeAuthors,
  type Commit,
} from "./analyze";

const DAY = 86_400;
const NOW = 1_800_000_000;

function record(
  hash: string,
  name: string,
  email: string,
  at: number,
  rows: string[],
): string {
  return `\x1e${hash}\x1f${name}\x1f${email}\x1f${at}\n\n${rows.join("\n")}\n`;
}

function commit(
  hash: string,
  email: string,
  files: [string, number][],
  at = NOW,
  name = email.split("@")[0],
): Commit {
  return {
    hash,
    authorName: name,
    authorEmail: email,
    timestamp: at,
    files: files.map(([path, added]) => ({
      path,
      added,
      deleted: 0,
      binary: false,
    })),
  };
}

describe("parseGitLog", () => {
  it("parses numstat rows, binaries and renames", () => {
    const raw =
      record("aaa", "Ada", "ada@x.com", NOW, [
        "10\t2\tapp/domain/locator.ts",
        "-\t-\tassets/fonts/Fraunces.ttf",
        "3\t1\tapp/{rig => agent}/tools.ts",
        "0\t0\told.md => new.md",
      ]) + record("bbb", "Bob", "bob@x.com", NOW - DAY, ["1\t0\tREADME.md"]);
    const commits = parseGitLog(raw);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      hash: "aaa",
      authorName: "Ada",
      authorEmail: "ada@x.com",
      timestamp: NOW,
    });
    expect(commits[0].files).toEqual([
      { path: "app/domain/locator.ts", added: 10, deleted: 2, binary: false },
      { path: "assets/fonts/Fraunces.ttf", added: 0, deleted: 0, binary: true },
      { path: "app/agent/tools.ts", added: 3, deleted: 1, binary: false },
      { path: "new.md", added: 0, deleted: 0, binary: false },
    ]);
    expect(commits[1].files).toHaveLength(1);
  });

  it("keeps commits with no file rows", () => {
    expect(parseGitLog(record("ccc", "C", "c@x.com", NOW, []))).toEqual([
      {
        hash: "ccc",
        authorName: "C",
        authorEmail: "c@x.com",
        timestamp: NOW,
        files: [],
      },
    ]);
  });
});

describe("resolveRenamePath", () => {
  it("handles braced, empty-side and bare renames", () => {
    expect(resolveRenamePath("a/{b => c}/d.ts")).toBe("a/c/d.ts");
    expect(resolveRenamePath("a/{b => }/d.ts")).toBe("a/d.ts");
    expect(resolveRenamePath("{ => x}/d.ts")).toBe("x/d.ts");
    expect(resolveRenamePath("a.ts => b.ts")).toBe("b.ts");
    expect(resolveRenamePath("plain.ts")).toBe("plain.ts");
  });
});

describe("classifyAuthor", () => {
  it("separates bots and agents from humans", () => {
    expect(
      classifyAuthor(
        "posthog[bot]",
        "206114724+posthog[bot]@users.noreply.github.com",
      ),
    ).toBe("bot");
    expect(classifyAuthor("Claude", "noreply@anthropic.com")).toBe("agent");
    expect(classifyAuthor("Cameron Hurd", "me@cameronhurd.com")).toBe("human");
  });
});

describe("groupByArea", () => {
  it("buckets by leading segments and skips generated paths", () => {
    expect(groupByArea("app/domain/epub/parse.ts")).toBe("app/domain");
    expect(groupByArea("app/domain/epub/parse.ts", 1)).toBe("app");
    expect(groupByArea("scripts/release.ts")).toBe("scripts");
    expect(groupByArea("ios/Sources/App/x.swift")).toBe("ios/Sources");
    expect(groupByArea("package.json")).toBe(ROOT_AREA);
    expect(groupByArea("package-lock.json")).toBeNull();
    expect(groupByArea("ios/Package.resolved")).toBeNull();
    expect(groupByArea("generated/prisma/index.js")).toBeNull();
    expect(groupByArea("prisma/migrations/0001_init/migration.sql")).toBeNull();
    expect(groupByArea("prisma/schema.prisma")).toBe("prisma");
    expect(groupByArea("public/fonts/generated/x.woff2")).toBeNull();
    expect(groupByArea("x/build/out.js", 2, [])).toBe("x/build");
    expect(groupByArea("x/build/out.js", 1, [])).toBe("x");
  });
});

describe("busFactor", () => {
  it("is the fewest authors covering half the churn", () => {
    expect(busFactor([100])).toBe(1);
    expect(busFactor([10, 10, 10])).toBe(2);
    expect(busFactor([50, 50])).toBe(1);
    expect(busFactor([40, 30, 30])).toBe(2);
    expect(busFactor([])).toBe(0);
  });
});

describe("decayWeight", () => {
  it("halves every half-life", () => {
    expect(decayWeight(0, 180)).toBe(1);
    expect(decayWeight(180 * DAY, 180)).toBeCloseTo(0.5);
    expect(decayWeight(360 * DAY, 180)).toBeCloseTo(0.25);
    expect(decayWeight(360 * DAY, 0)).toBe(1);
  });
});

describe("computeAreaStats", () => {
  it("merges authors by email (as .mailmap canonicalises them)", () => {
    const [area] = computeAreaStats(
      [
        commit("1", "me@x.com", [["app/rig/a.ts", 5]], NOW, "Cameron"),
        commit("2", "me@x.com", [["app/rig/b.ts", 5]], NOW, "Cameron Hurd"),
      ],
      { now: NOW },
    );
    expect(area.humanAuthors).toBe(1);
    expect(area.topAuthor).toMatchObject({ churn: 10, commits: 2, share: 1 });
  });

  it("keeps bots and agents out of ownership", () => {
    const [area] = computeAreaStats(
      [
        commit("1", "me@x.com", [["app/rig/a.ts", 10]]),
        commit("2", "noreply@anthropic.com", [["app/rig/a.ts", 500]]),
        commit("3", "1+posthog[bot]@users.noreply.github.com", [
          ["app/rig/b.ts", 500],
        ]),
      ],
      { now: NOW },
    );
    expect(area).toMatchObject({
      commits: 3,
      churn: 10,
      humanAuthors: 1,
      nonHumanCommits: 2,
      busFactor: 1,
    });
  });

  it("drops excluded paths and areas under min-commits", () => {
    const stats = computeAreaStats(
      [
        commit("1", "a@x.com", [
          ["package-lock.json", 9000],
          ["app/domain/x.ts", 1],
        ]),
        commit("2", "a@x.com", [["app/domain/y.ts", 1]]),
        commit("3", "a@x.com", [["scripts/ingest.ts", 1]]),
      ],
      { now: NOW, minCommits: 2 },
    );
    expect(stats.map((s) => s.area)).toEqual(["app/domain"]);
  });

  it("weights recent churn above old churn", () => {
    const [area] = computeAreaStats(
      [
        commit("1", "old@x.com", [["app/domain/x.ts", 100]], NOW - 360 * DAY),
        commit("2", "new@x.com", [["app/domain/x.ts", 100]], NOW),
      ],
      { now: NOW, halfLifeDays: 180 },
    );
    const byEmail = Object.fromEntries(
      area.authors.map((a) => [a.email, a.weightedShare]),
    );
    expect(area.authors.every((a) => a.share === 0.5)).toBe(true);
    expect(byEmail["new@x.com"]).toBeCloseTo(0.8);
    expect(byEmail["old@x.com"]).toBeCloseTo(0.2);
    expect(area.freshness).toBeCloseTo(0.625);
  });

  it("gives binary-only areas an ownership distribution", () => {
    const [area] = computeAreaStats(
      [
        {
          hash: "1",
          authorName: "A",
          authorEmail: "a@x.com",
          timestamp: NOW,
          files: [
            { path: "assets/fonts/F.ttf", added: 0, deleted: 0, binary: true },
          ],
        },
      ],
      { now: NOW },
    );
    expect(area).toMatchObject({ churn: 1, busFactor: 1 });
  });
});

describe("detectSilos", () => {
  const stats = computeAreaStats(
    [
      // Big sole-owned area, untouched for a year.
      commit("1", "a@x.com", [["app/rig/a.ts", 1000]], NOW - 365 * DAY),
      // Concentrated but shared: 90/10.
      commit("2", "a@x.com", [["app/domain/a.ts", 90]]),
      commit("3", "b@x.com", [["app/domain/b.ts", 10]]),
      // Evenly shared three ways — not a silo.
      commit("4", "a@x.com", [["ios/Sources/a.swift", 10]]),
      commit("5", "b@x.com", [["ios/Sources/b.swift", 10]]),
      commit("6", "c@x.com", [["ios/Sources/c.swift", 10]]),
      // Small sole-owned area, recent.
      commit("7", "b@x.com", [["prisma/schema.prisma", 20]]),
    ],
    { now: NOW },
  );
  const silos = detectSilos(stats, { now: NOW });

  it("flags by thresholds and orders by severity", () => {
    expect(silos.map((s) => s.stats.area)).toEqual([
      "app/rig",
      "app/domain",
      "prisma",
    ]);
    expect(silos[0].reasons).toEqual([
      "sole-author",
      "concentrated",
      "bus-factor-1",
    ]);
    expect(silos[1].reasons).toEqual(["concentrated", "bus-factor-1"]);
    expect(silos[1].severity).toBeCloseTo(90);
  });

  it("marks sole-owned, long-untouched areas stale", () => {
    expect(silos[0]).toMatchObject({ stale: true, daysSinceChange: 365 });
    expect(silos[2].stale).toBe(false);
  });

  it("respects a custom concentration threshold", () => {
    const strict = detectSilos(
      computeAreaStats(
        [
          commit("1", "a@x.com", [["app/domain/a.ts", 60]]),
          commit("2", "b@x.com", [["app/domain/b.ts", 30]]),
          commit("3", "c@x.com", [["app/domain/c.ts", 10]]),
        ],
        { now: NOW },
      ),
      { now: NOW, concentration: 0.95 },
    );
    // 60% is a bus factor of 1 regardless of the concentration bar.
    expect(strict[0].reasons).toEqual(["bus-factor-1"]);
  });
});

describe("findDocumentedAreas", () => {
  it("counts docs in the area or the area directly above it", () => {
    expect(
      findDocumentedAreas(
        ["ios/Sources", "app/rig", "app", "app/domain", "lib/x", ROOT_AREA],
        [
          "README.md",
          "ios/README.md",
          "app/rig/tools/NOTES.md",
          "lib/x/README.md",
        ],
      ),
    ).toEqual(["app/rig", "ios/Sources", "lib/x"]);
  });
});

describe("reporting", () => {
  const commits = [
    commit("1", "a@x.com", [["app/rig/a.ts", 10]]),
    commit("2", "noreply@anthropic.com", [["app/rig/a.ts", 10]], NOW, "Claude"),
  ];
  const areas = computeAreaStats(commits, { now: NOW });
  const report = {
    generatedAt: NOW,
    options: {
      depth: 2,
      minCommits: 1,
      halfLifeDays: 180,
      concentration: 0.8,
      staleDays: 180,
    },
    totals: summarizeAuthors(commits),
    areas,
    silos: detectSilos(areas, { now: NOW }),
    documentedAreas: findDocumentedAreas(
      areas.map((a) => a.area),
      ["README.md", "app/rig/README.md", "app/rig/a.ts"],
    ),
  };

  it("summarises humans and non-humans separately", () => {
    expect(report.totals.humanAuthors).toEqual([
      { name: "a", email: "a@x.com", commits: 1 },
    ]);
    expect(report.totals.nonHumanAuthors[0]).toMatchObject({ kind: "agent" });
    expect(report.documentedAreas).toEqual(["app/rig"]);
  });

  it("renders Markdown and JSON", () => {
    const md = renderMarkdown(report);
    expect(md).toContain("| 1 | `app/rig` |");
    expect(md).toContain("excluded from ownership");
    expect(JSON.parse(renderJson(report)).silos).toHaveLength(1);
  });
});
