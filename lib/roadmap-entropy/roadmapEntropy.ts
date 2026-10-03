// The pure half of the roadmap entropy detector: everything here takes
// already-fetched tracker data and returns numbers. No `gh`, no `git`, no
// clock — `scripts/roadmap-entropy.ts` owns all three and hands the results
// in, which is what lets this be tested with inline fixtures.
//
// It lives under lib/ rather than scripts/lib/ because lib/** is what
// vitest.config.ts already includes; scripts/ has no test entry, and this is
// the same kind of code lib/ is for anyway — plain, dependency-free functions.
//
// Vocabulary:
//   planned    — a PR that carries a milestone itself, or closes an issue
//                that does. Everything else is unplanned.
//   area       — the part of the tree a path belongs to (see AREAS).
//   anchored   — an area at least one planned PR has touched, i.e. the
//                roadmap has reached it at least once.
//
// The score, 0–100, is a weighted sum of four ratios (each 0–1, and 0 when
// its denominator is 0):
//
//   35 × unplanned merged PRs      / merged PRs
//   25 × open issues, no milestone / open issues
//   20 × stale open milestones     / open milestones
//   20 × merged PRs whose primary area is unanchored / merged PRs
//
// Bands: <25 low, <50 moderate, <75 high, otherwise severe. The weights are
// a judgment call, not a measurement: shipped work outside the roadmap counts
// most, a backlog nobody has sorted next, and the last two split the rest.

export interface Milestone {
  number: number;
  title: string;
  state: "open" | "closed";
  description: string | null;
  openIssues: number;
  closedIssues: number;
}

export interface Issue {
  number: number;
  title: string;
  state: "open" | "closed";
  milestone: string | null;
  createdAt: string;
  closedAt: string | null;
}

export interface PullRequest {
  number: number;
  title: string;
  milestone: string | null;
  mergedAt: string | null;
  closingIssues: number[];
  files: string[];
}

// Longest prefix wins, so `app/rig/` is matched before `app/`. The first six
// are the areas the roadmap question is actually about; the rest exist so
// that every path lands somewhere more specific than "other".
export const AREAS = [
  "ios/",
  "lib/paged-columns/",
  "app/rig/",
  "design/",
  ".github/",
  "openapi/",
  "app/",
  "lib/",
  "scripts/",
  "prisma/",
  "docs/",
] as const;

export const ROOT_AREA = "(root)";
export const OTHER_AREA = "(other)";

export function classifyPath(path: string): string {
  let best: string | null = null;
  for (const area of AREAS) {
    if (path.startsWith(area) && (!best || area.length > best.length)) {
      best = area;
    }
  }
  if (best) return best;
  return path.includes("/") ? OTHER_AREA : ROOT_AREA;
}

// The area most of a PR's files fall in. Ties go to whichever area sorts
// first, only so the answer is stable between runs. Null for a PR with no
// files (GitHub reports none for some very old or empty ones).
export function primaryArea(files: string[]): string | null {
  const counts = new Map<string, number>();
  for (const file of files) {
    const area = classifyPath(file);
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [area, count] of [...counts].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (best === null || count > counts.get(best)!) best = area;
  }
  return best;
}

export function isPlanned(pr: PullRequest, issues: Issue[]): boolean {
  if (pr.milestone) return true;
  return pr.closingIssues.some(
    (n) => issues.find((i) => i.number === n)?.milestone != null,
  );
}

// Monday (UTC) of the week an ISO timestamp falls in, as YYYY-MM-DD.
export function weekOf(iso: string): string {
  const d = new Date(iso);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return d.toISOString().slice(0, 10);
}

export interface WeeklyUnplanned {
  week: string;
  merged: number;
  unplanned: number;
  ratio: number;
}

export function weeklyUnplanned(
  prs: PullRequest[],
  issues: Issue[],
): WeeklyUnplanned[] {
  const weeks = new Map<string, { merged: number; unplanned: number }>();
  for (const pr of prs) {
    if (!pr.mergedAt) continue;
    const week = weekOf(pr.mergedAt);
    const row = weeks.get(week) ?? { merged: 0, unplanned: 0 };
    row.merged += 1;
    if (!isPlanned(pr, issues)) row.unplanned += 1;
    weeks.set(week, row);
  }
  return [...weeks]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, { merged, unplanned }]) => ({
      week,
      merged,
      unplanned,
      ratio: unplanned / merged,
    }));
}

export interface WeeklyFlow {
  week: string;
  opened: number;
  closed: number;
  net: number;
}

export function weeklyIssueFlow(issues: Issue[]): WeeklyFlow[] {
  const weeks = new Map<string, { opened: number; closed: number }>();
  const row = (week: string) => {
    if (!weeks.has(week)) weeks.set(week, { opened: 0, closed: 0 });
    return weeks.get(week)!;
  };
  for (const issue of issues) {
    row(weekOf(issue.createdAt)).opened += 1;
    if (issue.closedAt) row(weekOf(issue.closedAt)).closed += 1;
  }
  return [...weeks]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, { opened, closed }]) => ({
      week,
      opened,
      closed,
      net: opened - closed,
    }));
}

export type StaleReason =
  // Open, nothing left open in it, but work was closed against it: finished
  // and never closed.
  | "done-but-open"
  // Open and nothing has ever been filed against it.
  | "empty"
  // The description still says it is paused pending a milestone that has
  // since closed.
  | "stale-description";

export interface StaleMilestone {
  title: string;
  reasons: StaleReason[];
}

const PAUSED_PENDING = /paused pending (M\d+)/i;

export function staleMilestones(milestones: Milestone[]): StaleMilestone[] {
  const stale: StaleMilestone[] = [];
  for (const m of milestones) {
    if (m.state !== "open") continue;
    const reasons: StaleReason[] = [];
    if (m.openIssues === 0) {
      reasons.push(m.closedIssues > 0 ? "done-but-open" : "empty");
    }
    const blocker = m.description?.match(PAUSED_PENDING)?.[1].toUpperCase();
    if (
      blocker &&
      milestones.some(
        (other) =>
          other.state === "closed" &&
          other.title.toUpperCase().startsWith(`${blocker} `),
      )
    ) {
      reasons.push("stale-description");
    }
    if (reasons.length > 0) stale.push({ title: m.title, reasons });
  }
  return stale;
}

export interface AreaCluster {
  area: string;
  // Merged PRs with at least one file in the area. A PR touching several
  // areas is counted in each, so this column does not sum to the PR total.
  touching: number;
  plannedTouching: number;
  unplannedTouching: number;
  // Merged PRs with most of their files here — each PR counted exactly once.
  primary: number;
  anchored: boolean;
  firstMergedAt: string;
  lastMergedAt: string;
  // The unplanned PRs themselves, oldest first — what a reader of the
  // report actually wants to click through to.
  unplannedPrs: number[];
}

export function areaClusters(
  prs: PullRequest[],
  issues: Issue[],
): AreaCluster[] {
  const clusters = new Map<string, AreaCluster>();
  const merged = prs
    .filter((pr) => pr.mergedAt)
    .sort((a, b) => a.mergedAt!.localeCompare(b.mergedAt!));
  for (const pr of merged) {
    const planned = isPlanned(pr, issues);
    const primary = primaryArea(pr.files);
    for (const area of new Set(pr.files.map(classifyPath))) {
      const cluster = clusters.get(area) ?? {
        area,
        touching: 0,
        plannedTouching: 0,
        unplannedTouching: 0,
        primary: 0,
        anchored: false,
        firstMergedAt: pr.mergedAt!,
        lastMergedAt: pr.mergedAt!,
        unplannedPrs: [],
      };
      cluster.touching += 1;
      cluster.lastMergedAt = pr.mergedAt!;
      if (area === primary) cluster.primary += 1;
      if (planned) {
        cluster.plannedTouching += 1;
        cluster.anchored = true;
      } else {
        cluster.unplannedTouching += 1;
        cluster.unplannedPrs.push(pr.number);
      }
      clusters.set(area, cluster);
    }
  }
  return [...clusters.values()].sort(
    (a, b) => b.touching - a.touching || a.area.localeCompare(b.area),
  );
}

// A cluster is a scope-creep candidate when the roadmap has never reached
// its area and more than one PR has landed there — a single stray PR is
// noise, two is the start of a workstream. The single strays are still
// worth a glance (singleUnplannedAreas), they just aren't called creep.
export function scopeCreepCandidates(clusters: AreaCluster[]): AreaCluster[] {
  return clusters.filter((c) => !c.anchored && c.touching >= 2);
}

export function singleUnplannedAreas(clusters: AreaCluster[]): AreaCluster[] {
  return clusters.filter((c) => !c.anchored && c.touching === 1);
}

export interface OpenIssueAges {
  count: number;
  medianDays: number;
  maxDays: number;
}

export function unmilestonedOpenIssueAges(
  issues: Issue[],
  now: Date,
): OpenIssueAges {
  const ages = issues
    .filter((i) => i.state === "open" && !i.milestone)
    .map((i) =>
      Math.floor(
        (now.getTime() - new Date(i.createdAt).getTime()) / 86_400_000,
      ),
    )
    .sort((a, b) => a - b);
  if (ages.length === 0) return { count: 0, medianDays: 0, maxDays: 0 };
  const mid = Math.floor(ages.length / 2);
  const median =
    ages.length % 2 === 1 ? ages[mid] : (ages[mid - 1] + ages[mid]) / 2;
  return { count: ages.length, medianDays: median, maxDays: ages.at(-1)! };
}

export type Band = "low" | "moderate" | "high" | "severe";

export interface ScoreInputs {
  mergedPrs: number;
  unplannedPrs: number;
  openIssues: number;
  openUnmilestonedIssues: number;
  openMilestones: number;
  staleOpenMilestones: number;
  unanchoredPrs: number;
}

export interface Score {
  score: number;
  band: Band;
  components: {
    unplannedWork: number;
    unsortedBacklog: number;
    staleMilestones: number;
    unanchoredAreas: number;
  };
}

const WEIGHTS = {
  unplannedWork: 35,
  unsortedBacklog: 25,
  staleMilestones: 20,
  unanchoredAreas: 20,
};

const ratio = (n: number, d: number) => (d === 0 ? 0 : n / d);

export function bandFor(score: number): Band {
  if (score < 25) return "low";
  if (score < 50) return "moderate";
  if (score < 75) return "high";
  return "severe";
}

export function entropyScore(inputs: ScoreInputs): Score {
  const components = {
    unplannedWork:
      WEIGHTS.unplannedWork * ratio(inputs.unplannedPrs, inputs.mergedPrs),
    unsortedBacklog:
      WEIGHTS.unsortedBacklog *
      ratio(inputs.openUnmilestonedIssues, inputs.openIssues),
    staleMilestones:
      WEIGHTS.staleMilestones *
      ratio(inputs.staleOpenMilestones, inputs.openMilestones),
    unanchoredAreas:
      WEIGHTS.unanchoredAreas * ratio(inputs.unanchoredPrs, inputs.mergedPrs),
  };
  const score = Math.round(
    components.unplannedWork +
      components.unsortedBacklog +
      components.staleMilestones +
      components.unanchoredAreas,
  );
  return { score, band: bandFor(score), components };
}

export interface Report {
  milestones: Milestone[];
  stale: StaleMilestone[];
  mergedPrs: number;
  unplannedPrs: number;
  weekly: WeeklyUnplanned[];
  clusters: AreaCluster[];
  creep: AreaCluster[];
  watch: AreaCluster[];
  unanchoredPrs: number;
  flow: WeeklyFlow[];
  openIssues: number;
  openUnmilestoned: Issue[];
  openUnmilestonedAges: OpenIssueAges;
  score: Score;
}

export function buildReport(
  milestones: Milestone[],
  issues: Issue[],
  prs: PullRequest[],
  now: Date,
): Report {
  const merged = prs.filter((pr) => pr.mergedAt);
  const unplannedPrs = merged.filter((pr) => !isPlanned(pr, issues)).length;
  const stale = staleMilestones(milestones);
  const clusters = areaClusters(prs, issues);
  const open = issues.filter((i) => i.state === "open");
  const openUnmilestoned = open
    .filter((i) => !i.milestone)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const unanchoredPrs = clusters
    .filter((c) => !c.anchored)
    .reduce((sum, c) => sum + c.primary, 0);
  const score = entropyScore({
    mergedPrs: merged.length,
    unplannedPrs,
    openIssues: open.length,
    openUnmilestonedIssues: openUnmilestoned.length,
    openMilestones: milestones.filter((m) => m.state === "open").length,
    staleOpenMilestones: stale.length,
    unanchoredPrs,
  });
  return {
    milestones,
    stale,
    mergedPrs: merged.length,
    unplannedPrs,
    weekly: weeklyUnplanned(prs, issues),
    clusters,
    creep: scopeCreepCandidates(clusters),
    watch: singleUnplannedAreas(clusters),
    unanchoredPrs,
    flow: weeklyIssueFlow(issues),
    openIssues: open.length,
    openUnmilestoned,
    openUnmilestonedAges: unmilestonedOpenIssueAges(issues, now),
    score,
  };
}
