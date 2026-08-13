// Renders the .lighthouseci/ reports as a Markdown table for the workflow's
// GitHub step summary — the "perf reports along the way" half of the budget,
// so a PR shows its actual numbers rather than only a pass/fail check.
//
// Stdout is Markdown; the workflow appends it to $GITHUB_STEP_SUMMARY. Runs
// even when the budget assertions failed, which is exactly when seeing the
// numbers matters, so it must never throw on missing or partial reports.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const REPORTS_DIR = ".lighthouseci";
// Populated by the workflow's "Download baseline reports" step — the most
// recent successful run of this workflow on the PR's base branch, if one
// exists. Absent on push-to-main runs (nothing to compare main to) and on a
// PR's first run against a base branch with no prior green Lighthouse run.
const BASELINE_DIR = "lighthouse-baseline";

// Reuse the same assertMatrix the check itself asserts against, so the table
// can show "measured / budget" per row instead of a bare number — the point
// being to spot a regression by how close it sits to the ceiling, not just
// know that one happened after the check has already gone red.
const require = createRequire(import.meta.url);
const { ci } = require("../lighthouserc.cjs");

function budgetsForUrl(url) {
  const entry = ci.assert.assertMatrix.find((e) =>
    new RegExp(e.matchingUrlPattern).test(url),
  );
  return entry?.assertions ?? {};
}

function budgetValue(assertions, key) {
  const opts = assertions[key]?.[1];
  if (!opts) return null;
  return opts.maxNumericValue ?? opts.minScore ?? null;
}

if (!fs.existsSync(REPORTS_DIR)) {
  console.log(
    "## Lighthouse\n\nNo reports were produced — collection failed before any run finished.",
  );
  process.exit(0);
}

/** @returns {Map<string, Array<any>> | null} null if the directory doesn't exist at all. */
function loadReports(dir) {
  if (!fs.existsSync(dir)) return null;
  /** @type {Map<string, Array<any>>} */
  const byUrl = new Map();
  for (const file of fs.readdirSync(dir)) {
    if (!file.startsWith("lhr-") || !file.endsWith(".json")) continue;
    const lhr = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    if (!byUrl.has(lhr.finalUrl)) byUrl.set(lhr.finalUrl, []);
    byUrl.get(lhr.finalUrl).push(lhr);
  }
  return byUrl;
}

const byUrl = loadReports(REPORTS_DIR);
const baselineByUrl = loadReports(BASELINE_DIR);

// The same aggregation the assertions use (lighthouserc.cjs sets
// aggregationMethod: "median"), so the table can't disagree with the check.
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const metric = (lhrs, id) => {
  const values = lhrs
    .map((l) => l.audits[id]?.numericValue)
    .filter((v) => v != null);
  return values.length ? median(values) : null;
};

const transferSize = (lhrs, resourceType) => {
  const values = lhrs
    .map(
      (l) =>
        l.audits["resource-summary"]?.details?.items?.find(
          (i) => i.resourceType === resourceType,
        )?.transferSize,
    )
    .filter((v) => v != null);
  return values.length ? median(values) : null;
};

const kb = (n) => (n == null ? "—" : `${(n / 1024).toFixed(1)} KB`);
const ms = (n) => (n == null ? "—" : `${Math.round(n)} ms`);

// current - baseline, sign-prefixed. null if either side is missing (no
// baseline run, or a metric that failed to collect on one side).
const deltaMs = (current, base) =>
  current == null || base == null ? null : Math.round(current - base);
const deltaKb = (current, base) =>
  current == null || base == null ? null : (current - base) / 1024;
const deltaCls = (current, base) =>
  current == null || base == null ? null : current - base;
const deltaScore = (current, base) =>
  current == null || base == null
    ? null
    : Math.round(current * 100) - Math.round(base * 100);

const signed = (n, fmt) => (n == null ? "—" : `${n > 0 ? "+" : ""}${fmt(n)}`);

const lines = [
  "## Lighthouse",
  "",
  "Median of 3 runs per URL. Budgets live in `lighthouserc.cjs`.",
  "",
];

if (byUrl.size === 0) {
  lines.push(
    "No reports were produced — collection failed before any run finished.",
  );
}

lines.push(
  baselineByUrl
    ? "Δ vs the latest successful run on the base branch."
    : "No baseline run found on the base branch yet — Δ column omitted.",
  "",
);

for (const [url, lhrs] of byUrl) {
  const score = median(lhrs.map((l) => l.categories.performance.score));
  const cls = metric(lhrs, "cumulative-layout-shift");
  const lcp = metric(lhrs, "largest-contentful-paint");
  const fcp = metric(lhrs, "first-contentful-paint");
  const tbt = metric(lhrs, "total-blocking-time");
  const scriptKb = transferSize(lhrs, "script");
  const documentKb = transferSize(lhrs, "document");
  const stylesheetKb = transferSize(lhrs, "stylesheet");
  const fontKb = transferSize(lhrs, "font");
  const totalKb = transferSize(lhrs, "total");

  const budgets = budgetsForUrl(url);
  const scoreBudget = budgetValue(budgets, "categories:performance");

  const baseLhrs = baselineByUrl?.get(url);
  const base = baseLhrs && {
    score: median(baseLhrs.map((l) => l.categories.performance.score)),
    cls: metric(baseLhrs, "cumulative-layout-shift"),
    lcp: metric(baseLhrs, "largest-contentful-paint"),
    fcp: metric(baseLhrs, "first-contentful-paint"),
    tbt: metric(baseLhrs, "total-blocking-time"),
    scriptKb: transferSize(baseLhrs, "script"),
    documentKb: transferSize(baseLhrs, "document"),
    stylesheetKb: transferSize(baseLhrs, "stylesheet"),
    fontKb: transferSize(baseLhrs, "font"),
    totalKb: transferSize(baseLhrs, "total"),
  };

  const scoreDelta = base
    ? signed(deltaScore(score, base.score), (n) => `${n}`)
    : null;

  lines.push(
    `### \`${new URL(url).pathname}\` — performance ${Math.round(score * 100)}` +
      (scoreDelta ? ` (${scoreDelta} vs base)` : "") +
      (scoreBudget == null
        ? ""
        : ` (budget ≥ ${Math.round(scoreBudget * 100)})`),
    "",
    base
      ? "| Metric | Median | Δ vs base | Budget |"
      : "| Metric | Median | Budget |",
    base ? "| --- | ---: | ---: | ---: |" : "| --- | ---: | ---: |",
    row(
      "LCP",
      ms(lcp),
      base && signed(deltaMs(lcp, base.lcp), (n) => `${n} ms`),
      ms(budgetValue(budgets, "largest-contentful-paint")),
    ),
    row(
      "FCP",
      ms(fcp),
      base && signed(deltaMs(fcp, base.fcp), (n) => `${n} ms`),
      ms(budgetValue(budgets, "first-contentful-paint")),
    ),
    row(
      "TBT",
      ms(tbt),
      base && signed(deltaMs(tbt, base.tbt), (n) => `${n} ms`),
      ms(budgetValue(budgets, "total-blocking-time")),
    ),
    row(
      "CLS",
      cls == null ? "—" : cls.toFixed(3),
      base && signed(deltaCls(cls, base.cls), (n) => n.toFixed(3)),
      budgetValue(budgets, "cumulative-layout-shift") ?? "—",
    ),
    row(
      "Script",
      kb(scriptKb),
      base &&
        signed(deltaKb(scriptKb, base.scriptKb), (n) => `${n.toFixed(1)} KB`),
      kb(budgetValue(budgets, "resource-summary:script:size")),
    ),
    row(
      "Document",
      kb(documentKb),
      base &&
        signed(
          deltaKb(documentKb, base.documentKb),
          (n) => `${n.toFixed(1)} KB`,
        ),
      kb(budgetValue(budgets, "resource-summary:document:size")),
    ),
    row(
      "Stylesheet",
      kb(stylesheetKb),
      base &&
        signed(
          deltaKb(stylesheetKb, base.stylesheetKb),
          (n) => `${n.toFixed(1)} KB`,
        ),
      kb(budgetValue(budgets, "resource-summary:stylesheet:size")),
    ),
    row(
      "Font",
      kb(fontKb),
      base && signed(deltaKb(fontKb, base.fontKb), (n) => `${n.toFixed(1)} KB`),
      kb(budgetValue(budgets, "resource-summary:font:size")),
    ),
    row(
      "Total",
      kb(totalKb),
      base &&
        signed(deltaKb(totalKb, base.totalKb), (n) => `${n.toFixed(1)} KB`),
      kb(budgetValue(budgets, "resource-summary:total:size")),
    ),
    "",
  );
}

/** Builds one table row, omitting the Δ cell entirely when there's no baseline. */
function row(name, median, delta, budget) {
  return delta === null || delta === undefined
    ? `| ${name} | ${median} | ${budget} |`
    : `| ${name} | ${median} | ${delta} | ${budget} |`;
}

console.log(lines.join("\n"));
