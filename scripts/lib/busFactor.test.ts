import { describe, expect, it } from "vitest";
import {
  type Commit,
  aiAssistShare,
  analyze,
  areaOf,
  busFactor,
  formatReport,
  isExcludedPath,
  ownershipByFile,
  parseNumstatLog,
  parseRenamePath,
  rollupByArea,
} from "./busFactor";

const header = (sha: string, author: string, trailers = "") =>
  `--\t${sha}\t${author}\t${author.toLowerCase().replace(/ /g, ".")}@example.com\t${trailers}`;

describe("parseNumstatLog", () => {
  it("parses commits, binary entries, renames and co-author trailers", () => {
    const raw = [
      header(
        "bbb",
        "Ada",
        "Claude Opus 5.5 <noreply@anthropic.com>,Grace Hopper <grace@example.com>",
      ),
      "",
      "10\t2\tapp/a.ts",
      "-\t-\tassets/font.ttf",
      "3\t1\tapp/{old => new}/b.ts",
      header("aaa", "Grace"),
      "",
      "5\t0\tREADME.md",
      "",
    ].join("\n");

    const commits = parseNumstatLog(raw);
    expect(commits).toHaveLength(2);
    expect(commits[0].coAuthors).toEqual([
      "Claude Opus 5.5 <noreply@anthropic.com>",
      "Grace Hopper <grace@example.com>",
    ]);
    expect(commits[0].files).toEqual([
      { path: "app/a.ts", added: 10, deleted: 2, binary: false },
      { path: "assets/font.ttf", added: 0, deleted: 0, binary: true },
      {
        path: "app/new/b.ts",
        added: 3,
        deleted: 1,
        binary: false,
        renamedFrom: "app/old/b.ts",
      },
    ]);
    expect(commits[1]).toMatchObject({ sha: "aaa", coAuthors: [] });
  });

  it("returns no commits for empty history", () => {
    expect(parseNumstatLog("")).toEqual([]);
  });
});

describe("parseRenamePath", () => {
  it("handles bare, braced and empty-side renames", () => {
    expect(parseRenamePath("a.ts => b.ts")).toEqual({
      from: "a.ts",
      to: "b.ts",
    });
    expect(parseRenamePath("{Resources => Fonts}/x.ttf")).toEqual({
      from: "Resources/x.ttf",
      to: "Fonts/x.ttf",
    });
    expect(parseRenamePath("a/{ => sub}/b.ts")).toEqual({
      from: "a/b.ts",
      to: "a/sub/b.ts",
    });
    expect(parseRenamePath("plain/path.ts")).toBeNull();
  });
});

describe("isExcludedPath", () => {
  it("excludes generated, vendored and binary paths", () => {
    for (const p of [
      "package-lock.json",
      "generated/prisma/client.ts",
      "build/server/index.js",
      "node_modules/x/index.js",
      "design/support.js",
      "openapi/api-v1.json",
      "ios/Sources/Fonts/Fraunces.ttf",
      "public/favicon.ico",
    ]) {
      expect(isExcludedPath(p), p).toBe(true);
    }
    expect(isExcludedPath("app/routes/read.tsx")).toBe(false);
    expect(isExcludedPath("scripts/build.ts")).toBe(false);
  });
});

const commit = (
  sha: string,
  author: string,
  files: [string, number][],
  coAuthors: string[] = [],
): Commit => ({
  sha,
  author,
  email: "",
  coAuthors,
  files: files.map(([path, added]) => ({
    path,
    added,
    deleted: 0,
    binary: false,
  })),
});

describe("ownershipByFile", () => {
  it("counts only live, non-excluded files", () => {
    const files = ownershipByFile(
      [
        commit("1", "Ada", [
          ["app/a.ts", 5],
          ["deleted.ts", 9],
          ["package-lock.json", 900],
        ]),
      ],
      ["app/a.ts", "package-lock.json"],
    );
    expect(files.map((f) => f.path)).toEqual(["app/a.ts"]);
  });

  it("merges a .mailmap-normalised author into one owner", () => {
    // git applies .mailmap to %aN before we see it — both commits arrive
    // with the same canonical name.
    const raw = [
      header("2", "Cameron Hurd"),
      "",
      "4\t0\tapp/a.ts",
      header("1", "Cameron Hurd"),
      "",
      "6\t0\tapp/a.ts",
    ].join("\n");
    const [file] = ownershipByFile(parseNumstatLog(raw), ["app/a.ts"]);
    expect(file.byAuthor).toEqual({ "Cameron Hurd": 10 });
  });

  it("carries history forward through a rename", () => {
    const renamed: Commit = {
      sha: "2",
      author: "Grace",
      email: "",
      coAuthors: [],
      files: [
        {
          path: "new.ts",
          added: 1,
          deleted: 0,
          binary: false,
          renamedFrom: "old.ts",
        },
      ],
    };
    const [file] = ownershipByFile(
      [renamed, commit("1", "Ada", [["old.ts", 9]])],
      ["new.ts"],
    );
    expect(file).toMatchObject({
      path: "new.ts",
      total: 10,
      byAuthor: { Ada: 9, Grace: 1 },
    });
  });
});

describe("busFactor", () => {
  const of = (byAuthor: Record<string, number>) => ({
    total: Object.values(byAuthor).reduce((a, b) => a + b, 0),
    byAuthor,
  });

  it("is 1 for a single owner", () => {
    expect(busFactor(of({ Ada: 100 }))).toEqual({
      busFactor: 1,
      topOwner: "Ada",
      topShare: 1,
      authors: 1,
    });
  });

  it("needs more than the threshold, not exactly it", () => {
    expect(busFactor(of({ Ada: 50, Grace: 50 })).busFactor).toBe(2);
    expect(busFactor(of({ Ada: 51, Grace: 49 })).busFactor).toBe(1);
  });

  it("handles an even three-way split and a 60/30/10 split", () => {
    expect(busFactor(of({ A: 1, B: 1, C: 1 })).busFactor).toBe(2);
    const skewed = busFactor(of({ A: 60, B: 30, C: 10 }));
    expect(skewed).toMatchObject({
      busFactor: 1,
      topOwner: "A",
      topShare: 0.6,
    });
    expect(busFactor(of({ A: 60, B: 30, C: 10 }), 0.8).busFactor).toBe(2);
  });

  it("is 0 with no history", () => {
    expect(busFactor(of({})).busFactor).toBe(0);
  });
});

describe("rollupByArea", () => {
  const files = ownershipByFile(
    [
      commit("1", "Ada", [
        ["app/domain/a.ts", 10],
        ["app/routes/b.tsx", 5],
        ["package.json", 1],
      ]),
    ],
    ["app/domain/a.ts", "app/routes/b.tsx", "package.json"],
  );

  it("groups by the first `depth` directories", () => {
    expect(areaOf("app/domain/x/y.ts", 1)).toBe("app");
    expect(areaOf("app/domain/x/y.ts", 2)).toBe("app/domain");
    expect(areaOf("package.json", 2)).toBe("(root)");
    expect(
      rollupByArea(files, 1).map((a) => [a.area, a.files, a.total]),
    ).toEqual([
      ["app", 2, 15],
      ["(root)", 1, 1],
    ]);
    expect(rollupByArea(files, 2).map((a) => a.area)).toEqual([
      "app/domain",
      "app/routes",
      "(root)",
    ]);
  });
});

describe("aiAssistShare", () => {
  it("counts commits with a Claude co-author", () => {
    const [file] = ownershipByFile(
      [
        commit(
          "2",
          "Ada",
          [["a.ts", 30]],
          [
            "Someone <x@example.com>",
            "Claude Sonnet 5 <noreply@anthropic.com>",
          ],
        ),
        commit("1", "Ada", [["a.ts", 10]], ["Someone <x@example.com>"]),
      ],
      ["a.ts"],
    );
    expect(aiAssistShare(file)).toEqual({
      commits: 2,
      aiAssistedCommits: 1,
      commitShare: 0.5,
      lineShare: 0.75,
    });
  });
});

describe("analyze + formatReport", () => {
  it("reports an empty history without throwing", () => {
    const report = analyze([], [], { depth: 2, threshold: 0.5 });
    expect(report.overall.busFactor).toBe(0);
    expect(report.areas).toEqual([]);
    expect(formatReport(report, { format: "markdown" })).toContain("None.");
    expect(JSON.parse(formatReport(report, { format: "json" }))).toMatchObject({
      historyCommits: 0,
    });
  });

  it("lists the largest single-owner files first", () => {
    const report = analyze(
      [
        commit("2", "Grace", [["shared.ts", 10]]),
        commit("1", "Ada", [
          ["shared.ts", 10],
          ["big.ts", 50],
          ["small.ts", 5],
        ]),
      ],
      ["shared.ts", "big.ts", "small.ts"],
      { depth: 1, threshold: 0.5 },
    );
    expect(report.highestRisk.map((f) => f.path)).toEqual([
      "big.ts",
      "small.ts",
    ]);
    expect(report.authors).toEqual(["Ada", "Grace"]);
  });
});
