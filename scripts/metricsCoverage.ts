import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  buildReport,
  formatMarkdown,
  type SourceFile,
} from "./lib/metricsCoverage";

/**
 * `npm run metrics:coverage [-- --json] [-- --strict]` — static analytics
 * coverage report (see scripts/lib/metricsCoverage.ts). Offline: reads
 * source files only, never PostHog.
 *
 * Scans `app/` plus `scripts/` (where `epub_ingested`'s CLI emitter,
 * scripts/ingest.ts, lives). `--strict` exits non-zero when a declared event
 * has no emitter and no INTENTIONALLY_UNEMITTED entry.
 */

const root = process.cwd();
const SKIP_DIRS = new Set(["node_modules", "build", "generated", "+types"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|stories)\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    )
      out.push(path);
  }
  return out;
}

const read = (path: string): SourceFile => ({
  path: relative(root, path).split("\\").join("/"),
  content: readFileSync(path, "utf8"),
});

const files = [...walk(join(root, "app")), ...walk(join(root, "scripts"))]
  .map(read)
  .filter((f) => !f.path.includes("metricsCoverage"));
const routeFiles = files.filter((f) =>
  /^app\/routes\/[^/]+\.tsx?$/.test(f.path),
);

const report = buildReport({
  analyticsSource: readFileSync(join(root, "app/analytics.server.ts"), "utf8"),
  files,
  routeFiles,
});

const args = process.argv.slice(2);
process.stdout.write(
  args.includes("--json")
    ? JSON.stringify(report, null, 2) + "\n"
    : formatMarkdown(report),
);
if (args.includes("--strict") && report.neverEmitted.length > 0) {
  console.error(
    `metrics:coverage --strict: ${report.neverEmitted.length} declared event(s) have no emitter and no INTENTIONALLY_UNEMITTED entry: ${report.neverEmitted.join(", ")}`,
  );
  process.exitCode = 1;
}
