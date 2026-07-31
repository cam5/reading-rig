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

// Reuse the same assertMatrix the check itself asserts against, so the table
// can show "measured / budget" per row instead of a bare number — the point
// being to spot a regression by how close it sits to the ceiling, not just
// know that one happened after the check has already gone red.
const require = createRequire(import.meta.url);
const { ci } = require("../lighthouserc.cjs");

function budgetsForUrl(url) {
  const entry = ci.assert.assertMatrix.find((e) => new RegExp(e.matchingUrlPattern).test(url));
  return entry?.assertions ?? {};
}

function budgetValue(assertions, key) {
  const opts = assertions[key]?.[1];
  if (!opts) return null;
  return opts.maxNumericValue ?? opts.minScore ?? null;
}

if (!fs.existsSync(REPORTS_DIR)) {
  console.log("## Lighthouse\n\nNo reports were produced — collection failed before any run finished.");
  process.exit(0);
}

/** @type {Map<string, Array<any>>} */
const byUrl = new Map();
for (const file of fs.readdirSync(REPORTS_DIR)) {
  if (!file.startsWith("lhr-") || !file.endsWith(".json")) continue;
  const lhr = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, file), "utf8"));
  if (!byUrl.has(lhr.finalUrl)) byUrl.set(lhr.finalUrl, []);
  byUrl.get(lhr.finalUrl).push(lhr);
}

// The same aggregation the assertions use (lighthouserc.cjs sets
// aggregationMethod: "median"), so the table can't disagree with the check.
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const metric = (lhrs, id) => {
  const values = lhrs.map((l) => l.audits[id]?.numericValue).filter((v) => v != null);
  return values.length ? median(values) : null;
};

const transferSize = (lhrs, resourceType) => {
  const values = lhrs
    .map(
      (l) =>
        l.audits["resource-summary"]?.details?.items?.find((i) => i.resourceType === resourceType)
          ?.transferSize,
    )
    .filter((v) => v != null);
  return values.length ? median(values) : null;
};

const kb = (n) => (n == null ? "—" : `${(n / 1024).toFixed(1)} KB`);
const ms = (n) => (n == null ? "—" : `${Math.round(n)} ms`);

const lines = ["## Lighthouse", "", "Median of 3 runs per URL. Budgets live in `lighthouserc.cjs`.", ""];

if (byUrl.size === 0) {
  lines.push("No reports were produced — collection failed before any run finished.");
}

for (const [url, lhrs] of byUrl) {
  const score = median(lhrs.map((l) => l.categories.performance.score));
  const cls = metric(lhrs, "cumulative-layout-shift");
  const budgets = budgetsForUrl(url);
  const scoreBudget = budgetValue(budgets, "categories:performance");

  lines.push(
    `### \`${new URL(url).pathname}\` — performance ${Math.round(score * 100)}` +
      (scoreBudget == null ? "" : ` (budget ≥ ${Math.round(scoreBudget * 100)})`),
    "",
    "| Metric | Median | Budget |",
    "| --- | ---: | ---: |",
    `| LCP | ${ms(metric(lhrs, "largest-contentful-paint"))} | ${ms(budgetValue(budgets, "largest-contentful-paint"))} |`,
    `| FCP | ${ms(metric(lhrs, "first-contentful-paint"))} | ${ms(budgetValue(budgets, "first-contentful-paint"))} |`,
    `| TBT | ${ms(metric(lhrs, "total-blocking-time"))} | ${ms(budgetValue(budgets, "total-blocking-time"))} |`,
    `| CLS | ${cls == null ? "—" : cls.toFixed(3)} | ${budgetValue(budgets, "cumulative-layout-shift") ?? "—"} |`,
    `| Script | ${kb(transferSize(lhrs, "script"))} | ${kb(budgetValue(budgets, "resource-summary:script:size"))} |`,
    `| Document | ${kb(transferSize(lhrs, "document"))} | ${kb(budgetValue(budgets, "resource-summary:document:size"))} |`,
    `| Stylesheet | ${kb(transferSize(lhrs, "stylesheet"))} | ${kb(budgetValue(budgets, "resource-summary:stylesheet:size"))} |`,
    `| Font | ${kb(transferSize(lhrs, "font"))} | ${kb(budgetValue(budgets, "resource-summary:font:size"))} |`,
    `| Total | ${kb(transferSize(lhrs, "total"))} | ${kb(budgetValue(budgets, "resource-summary:total:size"))} |`,
    "",
  );
}

console.log(lines.join("\n"));
