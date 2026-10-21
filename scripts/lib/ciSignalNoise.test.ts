import { describe, expect, it } from "vitest";
import {
  NOISE_POLICY,
  classifyRun,
  isIrrelevant,
  markFlakes,
  minutesOf,
  policyFor,
  renderMarkdown,
  scoreRuns,
  type WorkflowRun,
} from "./ciSignalNoise";

let nextId = 1;

/** A completed, successful, two-minute pull_request run of CI touching app code — override what the case is about. */
function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: nextId++,
    workflow: "CI",
    workflowPath: ".github/workflows/ci.yml",
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    headSha: "aaaaaaa",
    baseSha: "bbbbbbb",
    runAttempt: 1,
    startedAt: "2026-10-20T06:00:00Z",
    updatedAt: "2026-10-20T06:02:00Z",
    changedFiles: ["app/routes/read.tsx"],
    ...overrides,
  };
}

const IOS_ONLY = [
  "ios/Package.swift",
  "ios/Sources/ReadingRigKit/Reader.swift",
];
const DOCS_ONLY = ["README.md", "docs/knowledge-silos.md"];
const WEB_WORKFLOWS = ["CI", "Lighthouse", "Chromatic"] as const;

describe("isIrrelevant", () => {
  it("calls an iOS-only diff irrelevant for every web workflow", () => {
    for (const wf of WEB_WORKFLOWS) {
      expect(isIrrelevant(IOS_ONLY, NOISE_POLICY[wf])).toBe(true);
    }
  });

  it("calls a docs-only diff irrelevant for every web workflow", () => {
    for (const wf of WEB_WORKFLOWS) {
      expect(isIrrelevant(DOCS_ONLY, NOISE_POLICY[wf])).toBe(true);
    }
  });

  it("never calls anything irrelevant for iOS, which path-filters itself", () => {
    expect(isIrrelevant(IOS_ONLY, NOISE_POLICY.iOS)).toBe(false);
    expect(isIrrelevant(DOCS_ONLY, NOISE_POLICY.iOS)).toBe(false);
  });

  it("is relevant when an app file changed", () => {
    expect(isIrrelevant(["app/routes/read.tsx"], NOISE_POLICY.CI)).toBe(false);
  });

  it("is relevant for a mixed diff — one relevant file is enough", () => {
    expect(
      isIrrelevant([...IOS_ONLY, "app/db.server.ts"], NOISE_POLICY.CI),
    ).toBe(false);
  });

  it("treats an empty or unknown file list as relevant", () => {
    expect(isIrrelevant([], NOISE_POLICY.CI)).toBe(false);
    expect(isIrrelevant(null, NOISE_POLICY.CI)).toBe(false);
  });

  it("ignores the other workflow files but not the workflow's own", () => {
    expect(isIrrelevant([".github/workflows/ios.yml"], NOISE_POLICY.CI)).toBe(
      true,
    );
    expect(isIrrelevant([".github/workflows/ci.yml"], NOISE_POLICY.CI)).toBe(
      false,
    );
    expect(
      isIrrelevant(
        [".github/workflows/lighthouse.yml"],
        NOISE_POLICY.Lighthouse,
      ),
    ).toBe(false);
  });

  it("knows what each web workflow actually builds", () => {
    // Storybook config: not in the Lighthouse bundle, but CI and Chromatic build it.
    expect(isIrrelevant([".storybook/main.ts"], NOISE_POLICY.Lighthouse)).toBe(
      true,
    );
    expect(isIrrelevant([".storybook/main.ts"], NOISE_POLICY.CI)).toBe(false);
    expect(isIrrelevant([".storybook/main.ts"], NOISE_POLICY.Chromatic)).toBe(
      false,
    );
    // Prisma: Chromatic's stories never import the client; CI and Lighthouse run migrations.
    const migration = ["prisma/migrations/20261001_x/migration.sql"];
    expect(isIrrelevant(migration, NOISE_POLICY.Chromatic)).toBe(true);
    expect(isIrrelevant(migration, NOISE_POLICY.CI)).toBe(false);
    expect(isIrrelevant(migration, NOISE_POLICY.Lighthouse)).toBe(false);
    // Tests: CI runs them; the other two never load them.
    expect(isIrrelevant(["app/domain/x.test.ts"], NOISE_POLICY.CI)).toBe(false);
    expect(
      isIrrelevant(["app/domain/x.test.ts"], NOISE_POLICY.Lighthouse),
    ).toBe(true);
    expect(isIrrelevant(["app/domain/x.test.ts"], NOISE_POLICY.Chromatic)).toBe(
      true,
    );
  });

  it("does not let `ios/**` swallow an unrelated path containing ios/", () => {
    expect(isIrrelevant(["app/ios/bridge.ts"], NOISE_POLICY.CI)).toBe(false);
  });
});

describe("policyFor", () => {
  it("gives an unknown workflow an empty ignore list", () => {
    expect(policyFor("Nightly Something")).toEqual([]);
    expect(policyFor("constructor")).toEqual([]);
  });

  it("returns the configured list for a known one", () => {
    expect(policyFor("CI")).toBe(NOISE_POLICY.CI);
  });
});

describe("classifyRun", () => {
  it("is signal for a relevant, successful pull_request run", () => {
    expect(classifyRun(run())).toBe("signal");
  });

  it("is superseded when cancelled (cancel-in-progress)", () => {
    expect(classifyRun(run({ conclusion: "cancelled" }))).toBe("superseded");
  });

  it("is irrelevant for an iOS-only pull_request run of a web workflow", () => {
    expect(classifyRun(run({ changedFiles: IOS_ONLY }))).toBe("irrelevant");
    expect(
      classifyRun(run({ workflow: "Lighthouse", changedFiles: DOCS_ONLY })),
    ).toBe("irrelevant");
  });

  it("counts a push-to-main run as signal even when its diff is all ignorable", () => {
    expect(classifyRun(run({ event: "push", changedFiles: IOS_ONLY }))).toBe(
      "signal",
    );
  });

  it("is signal when the file list is unknown (conservative)", () => {
    expect(classifyRun(run({ changedFiles: null }))).toBe("signal");
  });

  it("is pending while queued or in progress", () => {
    expect(classifyRun(run({ status: "queued", conclusion: null }))).toBe(
      "pending",
    );
    expect(classifyRun(run({ status: "in_progress", conclusion: null }))).toBe(
      "pending",
    );
  });

  it("is deploy for the manual deploy-qa workflow", () => {
    expect(
      classifyRun(
        run({
          workflow: "Deploy to staging-qa",
          workflowPath: ".github/workflows/deploy-qa.yml",
          event: "workflow_dispatch",
        }),
      ),
    ).toBe("deploy");
  });

  it("is signal for a failure nobody re-ran", () => {
    const failed = run({ conclusion: "failure" });
    expect(classifyRun(failed, markFlakes([failed]))).toBe("signal");
  });
});

describe("markFlakes", () => {
  it("marks a failure that a later run at the same commit passed", () => {
    const failed = run({
      conclusion: "failure",
      startedAt: "2026-10-20T06:00:00Z",
    });
    const rerun = run({
      id: failed.id,
      runAttempt: 2,
      startedAt: "2026-10-20T06:10:00Z",
      updatedAt: "2026-10-20T06:12:00Z",
    });
    const flakes = markFlakes([rerun, failed]); // order of input must not matter
    expect(flakes.has(failed)).toBe(true);
    expect(flakes.has(rerun)).toBe(false);
    expect(classifyRun(failed, flakes)).toBe("flaky");
    expect(classifyRun(rerun, flakes)).toBe("signal");
  });

  it("treats a timed-out run the same as a failed one", () => {
    const timedOut = run({ conclusion: "timed_out" });
    const rerun = run({ startedAt: "2026-10-20T07:00:00Z" });
    expect(markFlakes([timedOut, rerun]).has(timedOut)).toBe(true);
  });

  it("does not mark a failure that came after the success", () => {
    const passed = run({ startedAt: "2026-10-20T06:00:00Z" });
    const failedLater = run({
      conclusion: "failure",
      startedAt: "2026-10-20T07:00:00Z",
    });
    expect(markFlakes([passed, failedLater]).size).toBe(0);
  });

  it("needs the same workflow and the same commit", () => {
    const failed = run({ conclusion: "failure" });
    const otherSha = run({
      headSha: "ccccccc",
      startedAt: "2026-10-20T07:00:00Z",
    });
    const otherWorkflow = run({
      workflow: "Lighthouse",
      startedAt: "2026-10-20T07:00:00Z",
    });
    expect(markFlakes([failed, otherSha, otherWorkflow]).size).toBe(0);
  });
});

describe("minutesOf", () => {
  it("is updatedAt − startedAt in minutes, never negative", () => {
    expect(minutesOf(run())).toBe(2);
    expect(
      minutesOf(
        run({
          startedAt: "2026-10-20T06:05:00Z",
          updatedAt: "2026-10-20T06:00:00Z",
        }),
      ),
    ).toBe(0);
    expect(minutesOf(run({ startedAt: "not a date" }))).toBe(0);
  });
});

describe("scoreRuns", () => {
  const sample = [
    run(), // signal, 2 min
    run({
      startedAt: "2026-10-20T07:00:00Z",
      updatedAt: "2026-10-20T07:03:00Z",
    }), // signal, 3 min
    run({ conclusion: "cancelled", updatedAt: "2026-10-20T06:00:30Z" }), // superseded, 0.5 min
    run({ changedFiles: IOS_ONLY, updatedAt: "2026-10-20T06:04:00Z" }), // irrelevant, 4 min
    run({ status: "queued", conclusion: null }), // excluded
    run({ event: "workflow_dispatch", workflow: "Deploy to staging-qa" }), // excluded
    run({ event: "push", changedFiles: DOCS_ONLY }), // signal, 2 min, pushIgnorable
    run({ changedFiles: null }), // signal, 2 min, unknownFiles
    run({
      workflow: "Lighthouse",
      workflowPath: ".github/workflows/lighthouse.yml",
    }), // signal, 2 min
  ];

  it("scores each workflow as signal ÷ scored, excluding pending and deploy runs", () => {
    const card = scoreRuns(sample);
    const ci = card.workflows.find((w) => w.workflow === "CI")!;
    expect(ci).toMatchObject({
      signal: 4,
      superseded: 1,
      irrelevant: 1,
      flaky: 0,
      scored: 6,
      score: 66.7,
      noiseMinutes: 4.5,
      totalMinutes: 13.5,
      unknownFiles: 1,
      pushIgnorable: 1,
      topNoise: "irrelevant",
      workflowPath: ".github/workflows/ci.yml",
    });
    expect(card.excluded).toEqual({ pending: 1, deploy: 1 });
    expect(card.runs).toBe(sample.length);
  });

  it("lists workflows alphabetically and sums them into overall", () => {
    const card = scoreRuns(sample);
    expect(card.workflows.map((w) => w.workflow)).toEqual([
      "CI",
      "Deploy to staging-qa",
      "Lighthouse",
    ]);
    expect(card.overall).toMatchObject({
      signal: 5,
      superseded: 1,
      irrelevant: 1,
      scored: 7,
      score: 71.4,
      noiseMinutes: 4.5,
      totalMinutes: 15.5,
    });
    // A workflow with nothing scored has no score rather than a fake 100.
    const deploy = card.workflows.find(
      (w) => w.workflow === "Deploy to staging-qa",
    )!;
    expect(deploy.scored).toBe(0);
    expect(deploy.score).toBeNull();
    expect(deploy.topNoise).toBeNull();
  });

  it("picks the flaky pair up through markFlakes", () => {
    const failed = run({ conclusion: "failure" });
    const rerun = run({ runAttempt: 2, startedAt: "2026-10-20T06:10:00Z" });
    const card = scoreRuns([failed, rerun]);
    expect(card.overall).toMatchObject({
      signal: 1,
      flaky: 1,
      score: 50,
      topNoise: "flaky",
    });
  });

  it("scores all-noise as 0 and empty input as nothing", () => {
    const allNoise = scoreRuns([
      run({ conclusion: "cancelled" }),
      run({ changedFiles: IOS_ONLY }),
    ]);
    expect(allNoise.overall.score).toBe(0);
    expect(allNoise.overall.noiseMinutes).toBe(allNoise.overall.totalMinutes);

    const empty = scoreRuns([]);
    expect(empty.workflows).toEqual([]);
    expect(empty.overall.scored).toBe(0);
    expect(empty.overall.score).toBeNull();
    expect(empty.runs).toBe(0);
  });

  it("breaks a tie between noise kinds toward irrelevant, then superseded", () => {
    const tie = scoreRuns([
      run({ conclusion: "cancelled" }),
      run({ changedFiles: IOS_ONLY }),
    ]);
    expect(tie.overall.topNoise).toBe("irrelevant");
    const onlyCancelled = scoreRuns([run({ conclusion: "cancelled" })]);
    expect(onlyCancelled.overall.topNoise).toBe("superseded");
  });
});

describe("renderMarkdown", () => {
  it("renders a table row per workflow, a bold overall row, and a paths-ignore hint", () => {
    const md = renderMarkdown(
      scoreRuns([
        run(),
        run({ changedFiles: IOS_ONLY }),
        run({ changedFiles: IOS_ONLY }),
        run({ event: "push", changedFiles: DOCS_ONLY }),
        run({
          workflow: "Lighthouse",
          workflowPath: ".github/workflows/lighthouse.yml",
        }),
      ]),
    );
    expect(md).toContain("## CI signal-to-noise");
    expect(md).toContain("| CI | 50% | 2 | 0 | 2 | 0 | 4.0 | 8.0 |");
    expect(md).toContain("| Lighthouse | 100% | 1 | 0 | 0 | 0 | 0.0 | 2.0 |");
    expect(md).toContain("| **All workflows** | **60%** | **3** |");
    expect(md).toContain(
      "**CI** — 2 pull-request runs (4.0 min) changed only ignored paths",
    );
    expect(md).toContain("`paths-ignore`");
    expect(md).toContain("`.github/workflows/ci.yml`");
    expect(md).toContain(
      "would also skip 1 push-to-main run that counted as signal",
    );
    expect(md).toContain("`ios/**`");
    // Lighthouse had no noise, so no hint for it.
    expect(md).not.toContain("**Lighthouse** —");
  });

  it("gives no hint when the main noise is superseded, and mentions unknown files", () => {
    const md = renderMarkdown(
      scoreRuns([
        run(),
        run({ conclusion: "cancelled" }),
        run({ changedFiles: null }),
      ]),
    );
    expect(md).not.toContain("paths-ignore");
    expect(md).toContain("1 pull-request run had no resolvable file list");
  });

  it("says so when there is nothing to score", () => {
    expect(renderMarkdown(scoreRuns([]))).toContain(
      "No completed runs to score (0 runs sampled",
    );
    expect(
      renderMarkdown(scoreRuns([run({ status: "queued", conclusion: null })])),
    ).toContain("No completed runs to score (1 run sampled, 1 pending");
  });

  it("renders an all-noise sample as 0%", () => {
    const md = renderMarkdown(scoreRuns([run({ changedFiles: IOS_ONLY })]));
    expect(md).toContain("| CI | 0% |");
  });
});
