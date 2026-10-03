import { describe, expect, it } from "vitest";
import {
  areaClusters,
  bandFor,
  buildReport,
  classifyPath,
  entropyScore,
  isPlanned,
  primaryArea,
  scopeCreepCandidates,
  singleUnplannedAreas,
  staleMilestones,
  unmilestonedOpenIssueAges,
  weekOf,
  weeklyIssueFlow,
  weeklyUnplanned,
  type Issue,
  type Milestone,
  type PullRequest,
} from "./roadmapEntropy";

const issue = (over: Partial<Issue> & { number: number }): Issue => ({
  title: `issue ${over.number}`,
  state: "closed",
  milestone: null,
  createdAt: "2026-08-03T12:00:00Z",
  closedAt: null,
  ...over,
});

const pr = (over: Partial<PullRequest> & { number: number }): PullRequest => ({
  title: `pr ${over.number}`,
  milestone: null,
  mergedAt: "2026-08-04T12:00:00Z",
  closingIssues: [],
  files: ["app/root.tsx"],
  ...over,
});

const milestone = (
  over: Partial<Milestone> & { number: number; title: string },
): Milestone => ({
  state: "open",
  description: null,
  openIssues: 0,
  closedIssues: 0,
  ...over,
});

describe("classifyPath", () => {
  it("prefers the longest matching area", () => {
    expect(classifyPath("app/rig/tools/search.ts")).toBe("app/rig/");
    expect(classifyPath("app/routes/read.tsx")).toBe("app/");
    expect(classifyPath("lib/paged-columns/columnMath.ts")).toBe(
      "lib/paged-columns/",
    );
    expect(classifyPath("lib/other/thing.ts")).toBe("lib/");
  });

  it("matches the remaining named areas", () => {
    expect(classifyPath("ios/project.yml")).toBe("ios/");
    expect(classifyPath(".github/workflows/ci.yml")).toBe(".github/");
    expect(classifyPath("openapi/v1.json")).toBe("openapi/");
    expect(classifyPath("design/_ds/tokens.css")).toBe("design/");
  });

  it("separates root files from unknown directories", () => {
    expect(classifyPath("package.json")).toBe("(root)");
    expect(classifyPath("public/favicon.ico")).toBe("(other)");
  });

  it("does not match an area name that is only a prefix of a directory", () => {
    expect(classifyPath("ios-notes/todo.md")).toBe("(other)");
  });
});

describe("primaryArea", () => {
  it("picks the area with the most files", () => {
    expect(
      primaryArea(["ios/a.swift", "ios/b.swift", "app/root.tsx", "README.md"]),
    ).toBe("ios/");
  });

  it("breaks ties the same way regardless of file order", () => {
    expect(primaryArea(["ios/a.swift", "app/root.tsx"])).toBe(
      primaryArea(["app/root.tsx", "ios/a.swift"]),
    );
  });

  it("is null for a PR with no files", () => {
    expect(primaryArea([])).toBeNull();
  });
});

describe("isPlanned", () => {
  const issues = [
    issue({ number: 1, milestone: "M1 — Reader" }),
    issue({ number: 2 }),
  ];

  it("counts a PR carrying its own milestone", () => {
    expect(isPlanned(pr({ number: 10, milestone: "M1 — Reader" }), [])).toBe(
      true,
    );
  });

  it("counts a PR closing a milestoned issue", () => {
    expect(isPlanned(pr({ number: 10, closingIssues: [2, 1] }), issues)).toBe(
      true,
    );
  });

  it("does not count a PR closing only unmilestoned or unknown issues", () => {
    expect(isPlanned(pr({ number: 10, closingIssues: [2, 99] }), issues)).toBe(
      false,
    );
    expect(isPlanned(pr({ number: 10 }), issues)).toBe(false);
  });
});

describe("weekOf", () => {
  it("returns the Monday of the week, in UTC", () => {
    expect(weekOf("2026-08-05T10:00:00Z")).toBe("2026-08-03"); // Wednesday
    expect(weekOf("2026-08-03T00:00:00Z")).toBe("2026-08-03"); // Monday
    expect(weekOf("2026-08-09T23:59:59Z")).toBe("2026-08-03"); // Sunday
    expect(weekOf("2026-08-10T00:00:00Z")).toBe("2026-08-10");
  });

  it("crosses month boundaries", () => {
    expect(weekOf("2026-08-01T12:00:00Z")).toBe("2026-07-27");
  });
});

describe("weeklyUnplanned", () => {
  it("buckets merged PRs by week and ignores unmerged ones", () => {
    const issues = [issue({ number: 1, milestone: "M1 — Reader" })];
    const weeks = weeklyUnplanned(
      [
        pr({
          number: 10,
          mergedAt: "2026-08-04T00:00:00Z",
          closingIssues: [1],
        }),
        pr({ number: 11, mergedAt: "2026-08-06T00:00:00Z" }),
        pr({ number: 12, mergedAt: "2026-08-11T00:00:00Z" }),
        pr({ number: 13, mergedAt: null }),
      ],
      issues,
    );
    expect(weeks).toEqual([
      { week: "2026-08-03", merged: 2, unplanned: 1, ratio: 0.5 },
      { week: "2026-08-10", merged: 1, unplanned: 1, ratio: 1 },
    ]);
  });

  it("is empty when nothing has merged", () => {
    expect(weeklyUnplanned([pr({ number: 1, mergedAt: null })], [])).toEqual(
      [],
    );
  });
});

describe("weeklyIssueFlow", () => {
  it("counts an issue in the week it opened and the week it closed", () => {
    expect(
      weeklyIssueFlow([
        issue({
          number: 1,
          createdAt: "2026-08-04T00:00:00Z",
          closedAt: "2026-08-12T00:00:00Z",
        }),
        issue({ number: 2, state: "open", createdAt: "2026-08-05T00:00:00Z" }),
      ]),
    ).toEqual([
      { week: "2026-08-03", opened: 2, closed: 0, net: 2 },
      { week: "2026-08-10", opened: 0, closed: 1, net: -1 },
    ]);
  });
});

describe("staleMilestones", () => {
  const closedM1 = milestone({
    number: 1,
    title: "M1 — Reader spine",
    state: "closed",
    closedIssues: 11,
  });

  it("flags an open milestone with only closed issues", () => {
    expect(
      staleMilestones([
        milestone({ number: 2, title: "M2 — Notebook", closedIssues: 4 }),
      ]),
    ).toEqual([{ title: "M2 — Notebook", reasons: ["done-but-open"] }]);
  });

  it("flags an open milestone nothing was ever filed against", () => {
    expect(
      staleMilestones([milestone({ number: 4, title: "M4 — Library" })]),
    ).toEqual([{ title: "M4 — Library", reasons: ["empty"] }]);
  });

  it("flags a description paused on a milestone that has closed", () => {
    expect(
      staleMilestones([
        closedM1,
        milestone({
          number: 3,
          title: "M3 — The Rig",
          openIssues: 2,
          description: "Paused pending M1 (and M2). Stacked.",
        }),
      ]),
    ).toEqual([{ title: "M3 — The Rig", reasons: ["stale-description"] }]);
  });

  it("leaves a description alone while its blocker is still open", () => {
    expect(
      staleMilestones([
        { ...closedM1, state: "open", openIssues: 1 },
        milestone({
          number: 3,
          title: "M3 — The Rig",
          openIssues: 2,
          description: "Paused pending M1.",
        }),
      ]),
    ).toEqual([]);
  });

  it("does not confuse M1 with M10", () => {
    expect(
      staleMilestones([
        { ...closedM1, title: "M10 — Much later" },
        milestone({
          number: 3,
          title: "M3 — The Rig",
          openIssues: 2,
          description: "Paused pending M1.",
        }),
      ]),
    ).toEqual([]);
  });

  it("ignores closed milestones and open ones with open work", () => {
    expect(
      staleMilestones([
        closedM1,
        milestone({ number: 5, title: "M5 — Later", openIssues: 1 }),
      ]),
    ).toEqual([]);
  });
});

describe("areaClusters", () => {
  const issues = [issue({ number: 1, milestone: "M3 — The Rig" })];
  const prs = [
    pr({
      number: 10,
      mergedAt: "2026-08-02T00:00:00Z",
      closingIssues: [1],
      files: ["app/rig/agent.ts", "app/rig/tools/a.ts", "prisma/schema.prisma"],
    }),
    pr({
      number: 11,
      mergedAt: "2026-08-10T00:00:00Z",
      files: ["app/rig/agent.ts"],
    }),
    pr({
      number: 21,
      mergedAt: "2026-08-20T00:00:00Z",
      files: ["ios/b.swift", "openapi/v1.json"],
    }),
    pr({
      number: 20,
      mergedAt: "2026-08-19T00:00:00Z",
      files: ["ios/a.swift", "ios/c.swift"],
    }),
    pr({ number: 30, mergedAt: null, files: ["design/x.html"] }),
  ];
  const clusters = areaClusters(prs, issues);
  const byArea = Object.fromEntries(clusters.map((c) => [c.area, c]));

  it("counts a PR in every area it touches, and once as primary", () => {
    expect(byArea["app/rig/"]).toMatchObject({
      touching: 2,
      plannedTouching: 1,
      unplannedTouching: 1,
      primary: 2,
      anchored: true,
      unplannedPrs: [11],
    });
    expect(byArea["prisma/"]).toMatchObject({
      touching: 1,
      primary: 0,
      anchored: true,
    });
  });

  it("records the span and the unplanned PRs oldest first", () => {
    expect(byArea["ios/"]).toMatchObject({
      touching: 2,
      anchored: false,
      firstMergedAt: "2026-08-19T00:00:00Z",
      lastMergedAt: "2026-08-20T00:00:00Z",
      unplannedPrs: [20, 21],
    });
  });

  it("leaves unmerged PRs out", () => {
    expect(byArea["design/"]).toBeUndefined();
  });

  it("calls two or more unanchored PRs creep and one a watch item", () => {
    expect(scopeCreepCandidates(clusters).map((c) => c.area)).toEqual(["ios/"]);
    expect(singleUnplannedAreas(clusters).map((c) => c.area)).toEqual([
      "openapi/",
    ]);
  });
});

describe("unmilestonedOpenIssueAges", () => {
  const now = new Date("2026-10-03T00:00:00Z");

  it("measures only open issues with no milestone", () => {
    expect(
      unmilestonedOpenIssueAges(
        [
          issue({
            number: 1,
            state: "open",
            createdAt: "2026-09-23T00:00:00Z",
          }),
          issue({
            number: 2,
            state: "open",
            createdAt: "2026-09-03T00:00:00Z",
          }),
          issue({ number: 3, state: "open", milestone: "M5 — Later" }),
          issue({ number: 4, state: "closed" }),
        ],
        now,
      ),
    ).toEqual({ count: 2, medianDays: 20, maxDays: 30 });
  });

  it("is all zeroes when there are none", () => {
    expect(unmilestonedOpenIssueAges([], now)).toEqual({
      count: 0,
      medianDays: 0,
      maxDays: 0,
    });
  });
});

describe("entropyScore", () => {
  const none = {
    mergedPrs: 0,
    unplannedPrs: 0,
    openIssues: 0,
    openUnmilestonedIssues: 0,
    openMilestones: 0,
    staleOpenMilestones: 0,
    unanchoredPrs: 0,
  };

  it("is 0 for an empty tracker rather than NaN", () => {
    expect(entropyScore(none)).toMatchObject({ score: 0, band: "low" });
  });

  it("is 0 when everything is planned", () => {
    expect(
      entropyScore({ ...none, mergedPrs: 10, openIssues: 5, openMilestones: 3 })
        .score,
    ).toBe(0);
  });

  it("is 100 when nothing is", () => {
    expect(
      entropyScore({
        mergedPrs: 10,
        unplannedPrs: 10,
        openIssues: 5,
        openUnmilestonedIssues: 5,
        openMilestones: 3,
        staleOpenMilestones: 3,
        unanchoredPrs: 10,
      }),
    ).toMatchObject({ score: 100, band: "severe" });
  });

  it("weights each component independently", () => {
    expect(
      entropyScore({ ...none, mergedPrs: 10, unplannedPrs: 10 }).components,
    ).toEqual({
      unplannedWork: 35,
      unsortedBacklog: 0,
      staleMilestones: 0,
      unanchoredAreas: 0,
    });
    expect(
      entropyScore({ ...none, openMilestones: 4, staleOpenMilestones: 1 })
        .score,
    ).toBe(5);
  });

  it("puts band edges on the upper band", () => {
    expect(bandFor(0)).toBe("low");
    expect(bandFor(24)).toBe("low");
    expect(bandFor(25)).toBe("moderate");
    expect(bandFor(49)).toBe("moderate");
    expect(bandFor(50)).toBe("high");
    expect(bandFor(74)).toBe("high");
    expect(bandFor(75)).toBe("severe");
    expect(bandFor(100)).toBe("severe");
  });
});

describe("buildReport", () => {
  it("ties the pieces together", () => {
    const report = buildReport(
      [
        milestone({
          number: 1,
          title: "M1 — Reader",
          state: "closed",
          closedIssues: 1,
        }),
        milestone({ number: 2, title: "M2 — Notebook", closedIssues: 1 }),
      ],
      [
        issue({ number: 1, milestone: "M1 — Reader" }),
        issue({ number: 2, state: "open" }),
      ],
      [
        pr({ number: 10, closingIssues: [1] }),
        pr({ number: 11, files: ["ios/a.swift"] }),
        pr({ number: 12, files: ["ios/b.swift"] }),
        pr({ number: 13, mergedAt: null }),
      ],
      new Date("2026-10-03T00:00:00Z"),
    );
    expect(report.mergedPrs).toBe(3);
    expect(report.unplannedPrs).toBe(2);
    expect(report.unanchoredPrs).toBe(2);
    expect(report.creep.map((c) => c.area)).toEqual(["ios/"]);
    expect(report.openUnmilestoned.map((i) => i.number)).toEqual([2]);
    // 35 × 2/3 + 25 × 1/1 + 20 × 1/1 + 20 × 2/3
    expect(report.score).toMatchObject({ score: 82, band: "severe" });
  });
});
