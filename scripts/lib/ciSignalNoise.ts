import path from "node:path";

/**
 * The pure half of scripts/ciSignalNoise.ts: given a list of normalized
 * GitHub Actions runs, decide which ones could have told us something and
 * which were noise, score the ratio, and render it. No network, no `gh`,
 * no fs — the script owns all of that, the same split lighthouse-summary
 * and topology use, so everything in here is testable with inline fixtures.
 *
 * "Signal" is a run whose outcome could have carried information. The
 * three noise kinds are the ones this repo's workflows can actually
 * produce:
 *
 *   superseded  cancelled before finishing. Every workflow here sets
 *               `cancel-in-progress: true` on a per-ref concurrency group,
 *               so a cancelled run is one a newer push replaced. (A human
 *               pressing Cancel lands here too — indistinguishable from
 *               the API, and just as uninformative.)
 *   irrelevant  a pull_request run whose entire diff falls inside paths
 *               the workflow never exercises — an iOS-only or docs-only PR
 *               triggering CI, Lighthouse and Chromatic. The outcome was
 *               decided before the runner booted.
 *   flaky       a failed (or timed-out) run that a later attempt or run at
 *               the same commit passed. Nothing changed, so the failure
 *               said nothing about the code.
 *
 * Two kinds of run are left out of the denominator entirely rather than
 * scored: anything still queued or in progress (`pending`), and the manual
 * deploy-qa workflow (`deploy`), which is a human asking for a deployment,
 * not CI reacting to a change.
 *
 * Push-to-main runs are always signal, even when their diff is entirely
 * in ignored paths: they verify the merged tree (which the PR run didn't
 * see if main moved underneath it) and refresh the Lighthouse / Chromatic
 * baselines later PRs compare against. They are still counted under
 * `pushIgnorable` so a `paths-ignore` recommendation can say what it
 * would skip in full.
 *
 * Step-level analysis (a run whose only meaningful step was skipped, say)
 * is deliberately out of scope — this works from the runs list alone.
 */

export type NoiseKind = "superseded" | "irrelevant" | "flaky";
export type RunClass = NoiseKind | "signal" | "pending" | "deploy";

/** One workflow run (or one earlier attempt of a re-run run), normalized off the API. */
export interface WorkflowRun {
  id: number;
  /** The workflow's display name — "CI", "Lighthouse" — which is what NOISE_POLICY is keyed on. */
  workflow: string;
  /** `.github/workflows/ci.yml` etc.; only used to make the hint name the right file. */
  workflowPath: string | null;
  /** "pull_request" | "push" | "workflow_dispatch" … */
  event: string;
  /** "completed" | "queued" | "in_progress" … */
  status: string;
  /** "success" | "failure" | "cancelled" | "timed_out" | … ; null while pending. */
  conclusion: string | null;
  headSha: string;
  baseSha: string | null;
  runAttempt: number;
  /** ISO timestamps. Minutes are updatedAt − startedAt (see `minutesOf`). */
  startedAt: string;
  updatedAt: string;
  /**
   * Repo-relative paths the run's diff touched. `null` means the lookup
   * failed; such runs are scored as signal (the conservative call) and
   * counted under `unknownFiles` so the report can say how much it had to
   * assume.
   */
  changedFiles: readonly string[] | null;
}

const WORKFLOW_FILES = [
  "chromatic",
  "ci",
  "deploy-qa",
  "ios",
  "lighthouse",
].map((n) => `.github/workflows/${n}.yml`);

/** Every workflow file except the one named — a change to a sibling workflow can't affect this one. */
const otherWorkflows = (own: string) => WORKFLOW_FILES.filter((f) => f !== own);

/**
 * Per-workflow lists of globs a run's diff can live entirely inside without
 * the run being able to say anything. Derived from reading what each
 * workflow actually executes:
 *
 *   CI          format:check, typecheck, vitest, the smoke build and
 *               build-storybook. None of those look at ios/ or design/
 *               (Prettier ignores design/ outright), nor at Lighthouse's
 *               config and summary script (not in tsconfig: .cjs/.mjs).
 *               Markdown is the one soft spot — format:check would notice
 *               an unformatted .md — but the pre-commit hook already
 *               enforces that, which is the same reasoning ci.yml itself
 *               gives for format:check being a backstop.
 *   Lighthouse  builds and serves the real app. Stories, Storybook config,
 *               tests and the committed OpenAPI document never enter that
 *               bundle (the live /api/v1/openapi route is generated from
 *               code, not read from openapi/).
 *   Chromatic   build-storybook only. Tests, Prisma (no story imports the
 *               client — chromatic.yml says so), the OpenAPI document and
 *               Lighthouse's config are all outside it.
 *   iOS         ios.yml already path-filters its own triggers, so there's
 *               nothing left for a policy to add.
 *
 * Matching uses Node's `path.matchesGlob` (minimatch semantics): `**` does
 * not descend into dot-directories, which is why the workflow files are
 * listed by exact path rather than as `.github/**`.
 */
export const NOISE_POLICY: Readonly<Record<string, readonly string[]>> = {
  CI: [
    "ios/**",
    "design/**",
    "**/*.md",
    "lighthouserc.cjs",
    "scripts/lighthouse-summary.mjs",
    ...otherWorkflows(".github/workflows/ci.yml"),
  ],
  Lighthouse: [
    "ios/**",
    "design/**",
    "**/*.md",
    ".storybook/**",
    "**/*.stories.tsx",
    "**/*.test.ts",
    "openapi/**",
    ...otherWorkflows(".github/workflows/lighthouse.yml"),
  ],
  Chromatic: [
    "ios/**",
    "design/**",
    "**/*.md",
    "**/*.test.ts",
    "prisma/**",
    "openapi/**",
    "lighthouserc.cjs",
    ...otherWorkflows(".github/workflows/chromatic.yml"),
  ],
  iOS: [],
};

/** The ignore globs for a workflow; an unknown name gets none, so nothing of its is ever called irrelevant. */
export function policyFor(workflow: string): readonly string[] {
  return Object.hasOwn(NOISE_POLICY, workflow) ? NOISE_POLICY[workflow] : [];
}

/**
 * True when every changed file matches at least one ignore glob. An empty
 * or unknown file list is never irrelevant — "we don't know what changed"
 * must not read as "nothing relevant changed".
 */
export function isIrrelevant(
  files: readonly string[] | null,
  globs: readonly string[],
): boolean {
  if (!files || files.length === 0 || globs.length === 0) return false;
  return files.every((file) =>
    globs.some((glob) => path.posix.matchesGlob(file, glob)),
  );
}

const FAILED = new Set(["failure", "timed_out"]);

const byStart = (a: WorkflowRun, b: WorkflowRun) =>
  Date.parse(a.startedAt) - Date.parse(b.startedAt) ||
  a.runAttempt - b.runAttempt;

/**
 * The runs whose failure a later run of the same workflow at the same
 * commit contradicted. Same headSha already means "no new commits", so a
 * later success can only be a re-run (an earlier attempt, if the caller
 * expanded them, or a fresh run of the same ref).
 */
export function markFlakes(
  runs: readonly WorkflowRun[],
): ReadonlySet<WorkflowRun> {
  const groups = new Map<string, WorkflowRun[]>();
  for (const run of runs) {
    const key = `${run.workflow}\0${run.headSha}`;
    const group = groups.get(key);
    if (group) group.push(run);
    else groups.set(key, [run]);
  }

  const flaky = new Set<WorkflowRun>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort(byStart);
    ordered.forEach((run, i) => {
      if (!FAILED.has(run.conclusion ?? "")) return;
      if (ordered.slice(i + 1).some((later) => later.conclusion === "success"))
        flaky.add(run);
    });
  }
  return flaky;
}

export function classifyRun(
  run: WorkflowRun,
  flakes: ReadonlySet<WorkflowRun> = new Set(),
): RunClass {
  // The only workflow_dispatch workflow here is deploy-qa; nothing CI-ish
  // has a manual trigger, so the event alone identifies it.
  if (run.event === "workflow_dispatch") return "deploy";
  if (run.status !== "completed") return "pending";
  if (run.conclusion === "cancelled") return "superseded";
  // Irrelevance before flakiness: if the run should never have been
  // triggered, that's the more actionable cause of the two.
  if (
    run.event === "pull_request" &&
    isIrrelevant(run.changedFiles, policyFor(run.workflow))
  )
    return "irrelevant";
  if (flakes.has(run)) return "flaky";
  return "signal";
}

/**
 * Wall-clock minutes from start to last update. For a single-job workflow
 * (all of this repo's) that is also the runner minutes, give or take queue
 * time; it does not apply GitHub's per-OS billing multipliers.
 */
export function minutesOf(run: WorkflowRun): number {
  const ms = Date.parse(run.updatedAt) - Date.parse(run.startedAt);
  return Number.isFinite(ms) && ms > 0 ? ms / 60_000 : 0;
}

export interface WorkflowScore {
  workflow: string;
  workflowPath: string | null;
  signal: number;
  superseded: number;
  irrelevant: number;
  flaky: number;
  /** signal + the three noise kinds — the denominator. */
  scored: number;
  /** signal ÷ scored, as a percentage to one decimal; null when nothing was scored. */
  score: number | null;
  /** Minutes spent on the three noise kinds, to one decimal. */
  noiseMinutes: number;
  /** Minutes spent on every scored run, to one decimal. */
  totalMinutes: number;
  /** pull_request runs whose files couldn't be resolved — scored as signal on faith. */
  unknownFiles: number;
  /** push runs whose diff was entirely ignorable — scored as signal, but a paths-ignore would skip them. */
  pushIgnorable: number;
  /** The most common noise kind, or null if there was none. */
  topNoise: NoiseKind | null;
}

export interface Scorecard {
  /** Sorted by workflow name. */
  workflows: WorkflowScore[];
  /** The same counts summed over every workflow. */
  overall: WorkflowScore;
  /** Runs left out of every denominator. */
  excluded: { pending: number; deploy: number };
  /** How many runs went in, excluded ones included. */
  runs: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const NOISE_KINDS: readonly NoiseKind[] = ["irrelevant", "superseded", "flaky"];

interface Tally {
  workflowPath: string | null;
  counts: Record<RunClass, number>;
  noiseMinutes: number;
  totalMinutes: number;
  unknownFiles: number;
  pushIgnorable: number;
}

const emptyTally = (): Tally => ({
  workflowPath: null,
  counts: {
    signal: 0,
    superseded: 0,
    irrelevant: 0,
    flaky: 0,
    pending: 0,
    deploy: 0,
  },
  noiseMinutes: 0,
  totalMinutes: 0,
  unknownFiles: 0,
  pushIgnorable: 0,
});

function finish(workflow: string, t: Tally): WorkflowScore {
  const { signal, superseded, irrelevant, flaky } = t.counts;
  const scored = signal + superseded + irrelevant + flaky;
  // Strictly greater, iterating irrelevant → superseded → flaky, so a tie
  // goes to the kind with the clearest fix.
  let topNoise: NoiseKind | null = null;
  for (const kind of NOISE_KINDS) {
    if (t.counts[kind] > (topNoise ? t.counts[topNoise] : 0)) topNoise = kind;
  }
  return {
    workflow,
    workflowPath: t.workflowPath,
    signal,
    superseded,
    irrelevant,
    flaky,
    scored,
    score: scored === 0 ? null : round1((signal / scored) * 100),
    noiseMinutes: round1(t.noiseMinutes),
    totalMinutes: round1(t.totalMinutes),
    unknownFiles: t.unknownFiles,
    pushIgnorable: t.pushIgnorable,
    topNoise,
  };
}

export function scoreRuns(runs: readonly WorkflowRun[]): Scorecard {
  const flakes = markFlakes(runs);
  const perWorkflow = new Map<string, Tally>();
  const overall = emptyTally();

  for (const run of runs) {
    const kind = classifyRun(run, flakes);
    let tally = perWorkflow.get(run.workflow);
    if (!tally) {
      tally = emptyTally();
      perWorkflow.set(run.workflow, tally);
    }
    tally.workflowPath ??= run.workflowPath;

    for (const t of [tally, overall]) {
      t.counts[kind] += 1;
      if (kind === "pending" || kind === "deploy") continue;

      const minutes = minutesOf(run);
      t.totalMinutes += minutes;
      if (kind !== "signal") t.noiseMinutes += minutes;

      if (run.event === "pull_request" && run.changedFiles === null)
        t.unknownFiles += 1;
      if (
        run.event === "push" &&
        isIrrelevant(run.changedFiles, policyFor(run.workflow))
      )
        t.pushIgnorable += 1;
    }
  }

  return {
    workflows: [...perWorkflow]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, tally]) => finish(name, tally)),
    overall: finish("All workflows", overall),
    excluded: {
      pending: overall.counts.pending,
      deploy: overall.counts.deploy,
    },
    runs: runs.length,
  };
}

const pct = (score: number | null) =>
  score === null ? "—" : `${Math.round(score)}%`;
const min = (n: number) => n.toFixed(1);
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * Markdown for a GitHub step summary or a PR body: one table, then one
 * actionable line per workflow whose main noise source is irrelevant
 * triggers — the only kind with a one-line fix (`paths-ignore`).
 */
export function renderMarkdown(card: Scorecard): string {
  const lines = ["## CI signal-to-noise", ""];

  if (card.overall.scored === 0) {
    lines.push(
      `No completed runs to score (${plural(card.runs, "run")} sampled, ` +
        `${card.excluded.pending} pending, ${card.excluded.deploy} manual deploy).`,
      "",
    );
    return lines.join("\n");
  }

  lines.push(
    `Signal ÷ scored runs, over the last ${plural(card.runs, "run")} ` +
      `(${card.excluded.pending} queued/in-progress and ${card.excluded.deploy} ` +
      `manual deploy ${card.excluded.deploy === 1 ? "run" : "runs"} excluded). ` +
      "Noise is a run cancelled by a newer push (superseded), a pull-request run " +
      "whose diff touched only paths the workflow never exercises (irrelevant), " +
      "or a failure that passed on re-run at the same commit (flaky). " +
      "Push-to-main runs always count as signal. Minutes are wall-clock per run.",
    "",
    "| Workflow | Score | Signal | Superseded | Irrelevant | Flaky | Noise min | Total min |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );

  const row = (s: WorkflowScore, bold = false) => {
    const b = (v: string | number) => (bold ? `**${v}**` : `${v}`);
    return `| ${b(s.workflow)} | ${b(pct(s.score))} | ${b(s.signal)} | ${b(s.superseded)} | ${b(s.irrelevant)} | ${b(s.flaky)} | ${b(min(s.noiseMinutes))} | ${b(min(s.totalMinutes))} |`;
  };
  for (const s of card.workflows) lines.push(row(s));
  lines.push(row(card.overall, true), "");

  const hints: string[] = [];
  for (const s of card.workflows) {
    if (s.topNoise !== "irrelevant") continue;
    const globs = policyFor(s.workflow)
      .map((g) => `\`${g}\``)
      .join(", ");
    const where = s.workflowPath ? ` in \`${s.workflowPath}\`` : "";
    const also =
      s.pushIgnorable > 0
        ? `, and would also skip ${plural(s.pushIgnorable, "push-to-main run")} that counted as signal here`
        : "";
    hints.push(
      `- **${s.workflow}** — ${plural(s.irrelevant, "pull-request run")} ` +
        `(${min(s.noiseMinutes)} min) changed only ignored paths. A \`paths-ignore\` ` +
        `on \`pull_request\` and \`push\`${where} would have skipped them${also}. ` +
        `Globs: ${globs}.`,
    );
  }
  if (hints.length) lines.push(...hints, "");

  if (card.overall.unknownFiles > 0) {
    lines.push(
      `${plural(card.overall.unknownFiles, "pull-request run")} had no resolvable file list and ` +
        "were scored as signal.",
      "",
    );
  }

  return lines.join("\n");
}
