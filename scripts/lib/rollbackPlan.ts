/**
 * Classifies a git change set by *how it can be undone* under this repo's
 * deploy model, and renders that as a Markdown rollback plan. Pure — no git,
 * no filesystem, no Railway, no database; scripts/rollbackPlan.ts does the
 * (read-only) git reading and hands the result here.
 *
 * The deploy model this encodes (see RUNBOOK.md / MIGRATIONS.md):
 *   - Railway builds and boots `npm start`, which runs scripts/release.ts
 *     (`prisma migrate deploy` against prod's persistent SQLite volume)
 *     before the server listens; railway.toml's /healthz check keeps the
 *     previous deployment serving until the new one passes.
 *   - PR environments and staging-qa `migrate reset` + reseed on every
 *     deploy, so only production has state a rollback has to care about.
 *   - The iOS app is built and shipped outside Railway entirely.
 *
 * So app code rolls back by redeploying the previous deployment, but an
 * applied migration does not: redeploying old code leaves the new SQL in
 * place. That asymmetry is the whole reason this exists.
 */

export type RiskLevel = "low" | "medium" | "high";

export type ChangedFile = {
  /** `git diff --name-status --no-renames` status letter: A, M, D, T… */
  status: string;
  path: string;
  /** File contents at head (only fetched for files that need it). */
  contents?: string;
  /** File contents at base (only fetched for package.json). */
  baseContents?: string;
};

export type CategoryId =
  | "app"
  | "migration"
  | "schema-drift"
  | "seed-data"
  | "pipeline"
  | "dependencies"
  | "ios"
  | "no-runtime"
  | "other";

export type RollbackCategory = {
  id: CategoryId;
  title: string;
  risk: RiskLevel;
  /** Whether undoing this involves a Railway deploy at all. */
  railway: boolean;
  files: string[];
  guidance: string[];
  warnings: string[];
};

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export function maxRisk(categories: RollbackCategory[]): RiskLevel {
  return categories.reduce<RiskLevel>(
    (max, c) => (RISK_ORDER[c.risk] > RISK_ORDER[max] ? c.risk : max),
    "low",
  );
}

const MIGRATION_SQL = /^prisma\/migrations\/([^/]+)\/migration\.sql$/;
const SEED_DATA_FILES = new Set([
  "prisma/seed.ts",
  "scripts/ingest.ts",
  "scripts/seedLibrary.ts",
  "scripts/lib/seedLibraryManifest.ts",
]);
const PIPELINE_FILES = new Set([
  "railway.toml",
  "scripts/release.ts",
  // Runs inside release.ts on every deploy, so it's part of the boot path.
  "scripts/setup-agent.ts",
]);

/**
 * Statements in a migration that can't be undone by a compensating
 * migration alone — they lose data or rewrite a table holding real rows.
 * Comments are stripped first (migration headers routinely *describe*
 * DROP/INSERT in prose), except Prisma's own `-- RedefineTables` marker,
 * which is checked on the raw text.
 */
export function findDestructiveStatements(sql: string): string[] {
  const found: string[] = [];
  if (/^--\s*RedefineTables\b/m.test(sql)) {
    found.push("RedefineTables (table rewrite: copy into new_*, drop old)");
  }
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
  const checks: [RegExp, string][] = [
    [/\bDROP\s+TABLE\b(?!\s+IF\s+EXISTS\s+"new_)/i, "DROP TABLE"],
    [/\bDROP\s+COLUMN\b/i, "DROP COLUMN"],
    [/\bINSERT\s+INTO\s+"new_/i, 'INSERT INTO "new_…" (table copy)'],
    [/\bDELETE\s+FROM\b/i, "DELETE"],
    [/\bUPDATE\s+\S+\s+SET\b/i, "UPDATE"],
  ];
  for (const [re, label] of checks) {
    if (re.test(code) && !found.some((f) => f.startsWith(label))) {
      found.push(label);
    }
  }
  for (const stmt of code.split(";")) {
    if (
      /\bALTER\s+TABLE\b[\s\S]*\bADD\s+(COLUMN\s+)?/i.test(stmt) &&
      /\bNOT\s+NULL\b/i.test(stmt) &&
      !/\bDEFAULT\b/i.test(stmt)
    ) {
      found.push("ADD COLUMN … NOT NULL without DEFAULT");
      break;
    }
  }
  return found;
}

type PackageJson = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function parsePackageJson(text: string | undefined): PackageJson | undefined {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as PackageJson;
  } catch {
    return undefined;
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Which parts of package.json changed. Unknown contents → assume deps. */
function packageJsonChanges(file: ChangedFile): {
  pipeline: boolean;
  deps: boolean;
} {
  const before = parsePackageJson(file.baseContents);
  const after = parsePackageJson(file.contents);
  if (!before || !after) return { pipeline: false, deps: true };
  return {
    pipeline:
      before.scripts?.start !== after.scripts?.start ||
      before.scripts?.release !== after.scripts?.release,
    deps:
      !sameJson(before.dependencies, after.dependencies) ||
      !sameJson(before.devDependencies, after.devDependencies),
  };
}

function isNoRuntime(path: string): boolean {
  return (
    path.startsWith(".github/") ||
    path.endsWith(".md") ||
    /\.test\.tsx?$/.test(path) ||
    /\.stories\.tsx?$/.test(path)
  );
}

function isApp(path: string): boolean {
  return /^(app|lib|public)\//.test(path);
}

export function classifyChanges(files: ChangedFile[]): RollbackCategory[] {
  const buckets = new Map<CategoryId, string[]>();
  const add = (id: CategoryId, path: string) => {
    const list = buckets.get(id) ?? [];
    if (!list.includes(path)) list.push(path);
    buckets.set(id, list);
  };

  const migrations: {
    name: string;
    status: string;
    destructive: string[];
  }[] = [];
  let schemaChanged = false;
  let lockfileChanged = false;
  let packageDepsChanged = false;

  for (const file of files) {
    const { path } = file;
    const migration = MIGRATION_SQL.exec(path);
    if (migration) {
      migrations.push({
        name: migration[1],
        status: file.status,
        destructive:
          file.status === "A" && file.contents !== undefined
            ? findDestructiveStatements(file.contents)
            : [],
      });
      add("migration", path);
    } else if (path.startsWith("prisma/migrations/")) {
      // migration_lock.toml or other files alongside migrations.
      add("migration", path);
    } else if (path === "prisma/schema.prisma") {
      schemaChanged = true;
      add("schema-drift", path);
    } else if (SEED_DATA_FILES.has(path)) {
      add("seed-data", path);
    } else if (PIPELINE_FILES.has(path)) {
      add("pipeline", path);
    } else if (path === "package.json") {
      const changes = packageJsonChanges(file);
      if (changes.pipeline) add("pipeline", path);
      if (changes.deps) {
        packageDepsChanged = true;
        add("dependencies", path);
      }
      // Only dev-facing scripts changed: nothing on deploy runs them.
      if (!changes.pipeline && !changes.deps) add("no-runtime", path);
    } else if (path === "package-lock.json") {
      lockfileChanged = true;
      add("dependencies", path);
    } else if (path.startsWith("ios/")) {
      add("ios", path);
    } else if (isNoRuntime(path)) {
      add("no-runtime", path);
    } else if (isApp(path)) {
      add("app", path);
    } else {
      add("other", path);
    }
  }

  const categories: RollbackCategory[] = [];
  const filesIn = (id: CategoryId) => buckets.get(id) ?? [];

  if (buckets.has("app")) {
    categories.push({
      id: "app",
      title: "App/server code",
      risk: "low",
      railway: true,
      files: filesIn("app"),
      guidance: [
        "Reversible. Fastest path: in the Railway dashboard, redeploy the production deployment that was serving before this merge.",
        "Durable path: `git revert` the merge commit and merge that PR, so main matches what's running.",
        "railway.toml's `healthcheckPath = /healthz` keeps the previous deployment serving until the new one passes, so a boot-time crash never takes traffic.",
      ],
      warnings: [],
    });
  }

  if (buckets.has("migration")) {
    const added = migrations.filter((m) => m.status === "A");
    const edited = migrations.filter((m) => m.status !== "A");
    const destructive = added.filter((m) => m.destructive.length > 0);
    const warnings: string[] = [];
    for (const m of destructive) {
      warnings.push(
        `**HIGH** \`${m.name}\`: ${m.destructive.join(", ")}. Redeploying old code can't bring back dropped or rewritten data. Snapshot the production volume before merging.`,
      );
    }
    for (const m of edited) {
      warnings.push(
        `**HIGH** \`${m.name}\` was ${m.status === "D" ? "deleted" : "modified"}. \`prisma migrate deploy\` never re-runs an already-applied migration, so production and the repo will silently diverge. Add a new migration instead.`,
      );
    }
    categories.push({
      id: "migration",
      title: "Prisma migrations",
      risk: destructive.length > 0 || edited.length > 0 ? "high" : "medium",
      railway: true,
      files: filesIn("migration"),
      guidance: [
        "FORWARD-ONLY. `npm start` runs scripts/release.ts, which runs `prisma migrate deploy` on boot. Once the new deployment boots, the SQL is applied to production's persistent volume, and redeploying the previous deployment does **not** undo it.",
        "To roll back: ship a new compensating migration (expand/contract, see MIGRATIONS.md), or restore the production volume from a snapshot taken before the merge.",
        "Old code must still run against the new schema for a dashboard redeploy to be safe. Additive changes (new table, nullable column) usually are; renames, drops, and new required columns are not.",
        "Only production matters here: PR environments and staging-qa `migrate reset` and reseed on every deploy.",
        ...(added.length > 0
          ? [`Added: ${added.map((m) => `\`${m.name}\``).join(", ")}.`]
          : []),
      ],
      warnings,
    });
  }

  if (schemaChanged && !migrations.some((m) => m.status === "A")) {
    categories.push({
      id: "schema-drift",
      title: "Schema changed without a migration",
      risk: "medium",
      railway: false,
      files: filesIn("schema-drift"),
      guidance: [
        "Nothing reaches production from schema.prisma alone; only committed migrations do.",
      ],
      warnings: [
        "`prisma/schema.prisma` changed but no migration was added. CI's `prisma migrate diff --exit-code` will fail this build. Run `npm run db:migrate -- --name <description>` and commit the migration with the schema (MIGRATIONS.md step 4).",
      ],
    });
  }

  if (buckets.has("seed-data")) {
    categories.push({
      id: "seed-data",
      title: "Seed/ingest scripts (not run on production deploys)",
      risk: "low",
      railway: false,
      files: filesIn("seed-data"),
      guidance: [
        "scripts/release.ts only runs seed, ingest, and seedLibrary in its ephemeral branch (PR environments and staging-qa, which `migrate reset` first). Production runs `deployMigrations()` alone, so merging this writes nothing to the production database.",
        "Production only gets these rows from a manual run. If someone ran one there, reverting the code won't remove what it upserted (deterministic ids, nothing deletes them); undoing that is a deliberate data change, following RUNBOOK.md's 'Before any manual write against the live database'.",
        "In PR environments and staging-qa, the next deploy resets and reseeds, so a revert is enough.",
      ],
      warnings: [],
    });
  }

  if (buckets.has("pipeline")) {
    categories.push({
      id: "pipeline",
      title: "Deploy pipeline",
      risk: "medium",
      railway: true,
      files: filesIn("pipeline"),
      guidance: [
        "This changes how every deploy boots (railway.toml, release.ts, or the `start`/`release` scripts). If boot breaks, the previous deployment keeps serving while retries run out.",
        "Roll back by redeploying the prior production deployment from the Railway dashboard, then `git revert` so main matches.",
        "Check any dashboard-side settings this touched against railway.toml, and verify per RUNBOOK.md 'Verifying recovery'.",
      ],
      warnings: [],
    });
  }

  if (buckets.has("dependencies")) {
    const warnings: string[] = [];
    if (packageDepsChanged && !lockfileChanged) {
      warnings.push(
        "package.json dependencies changed but package-lock.json did not, so `npm ci` will fail the build.",
      );
    }
    categories.push({
      id: "dependencies",
      title: "Dependencies",
      risk: "low",
      railway: true,
      files: filesIn("dependencies"),
      guidance: [
        "Reversible by redeploying the previous deployment, since the old build has its own node_modules.",
        "To revert in git, revert package.json **and** package-lock.json together. Reverting one without the other breaks `npm ci`.",
      ],
      warnings,
    });
  }

  if (buckets.has("ios")) {
    categories.push({
      id: "ios",
      title: "iOS app",
      risk: "low",
      railway: false,
      files: filesIn("ios"),
      guidance: [
        "Not deployed by Railway. To roll back, re-archive the prior commit and ship a new TestFlight/App Store build. Installed builds don't change until users update.",
      ],
      warnings: [],
    });
  }

  if (buckets.has("no-runtime")) {
    categories.push({
      id: "no-runtime",
      title: "No runtime effect (CI, docs, tests, dev scripts)",
      risk: "low",
      railway: false,
      files: filesIn("no-runtime"),
      guidance: ["No runtime rollback needed. `git revert` if wanted."],
      warnings: [],
    });
  }

  if (buckets.has("other")) {
    categories.push({
      id: "other",
      title: "Unclassified",
      risk: "low",
      railway: false,
      files: filesIn("other"),
      guidance: [
        "Not recognized by this tool. If it ships in the build (vite/react-router config, anything the server imports), treat it like app code. Otherwise no runtime rollback is needed.",
      ],
      warnings: [],
    });
  }

  return categories;
}

export function renderRollbackPlan(
  categories: RollbackCategory[],
  range: { base: string; head: string },
): string {
  const lines: string[] = [
    `## Rollback plan for \`${range.base}..${range.head}\``,
    "",
  ];
  if (categories.length === 0) {
    lines.push("No changes in this range.");
    return lines.join("\n") + "\n";
  }

  const risk = maxRisk(categories);
  const railway = categories.some((c) => c.railway);
  const migration = categories.find((c) => c.id === "migration");

  lines.push(`**Overall risk: ${risk.toUpperCase()}**`, "");
  if (!railway) {
    lines.push("Nothing in this change set deploys to Railway.", "");
  }

  const checklist: string[] = [];
  if (railway) {
    checklist.push(
      "Note the current production deployment in Railway so you know which one to redeploy.",
    );
  }
  if (migration) {
    checklist.push(
      "Read every new `migration.sql`, and confirm it says whether prod rows need a backfill (MIGRATIONS.md step 3).",
    );
  }
  if (risk === "high") {
    checklist.push(
      "**Snapshot the production volume's db file before merging.** See RUNBOOK.md 'Before any manual write against the live database'.",
    );
  }
  if (checklist.length > 0) {
    lines.push("### Before merging", "");
    for (const item of checklist) lines.push(`- [ ] ${item}`);
    lines.push("");
  }

  for (const c of categories) {
    lines.push(`### ${c.title} (${c.risk})`, "");
    if (c.warnings.length > 0) {
      lines.push(c.warnings.map((w) => `> ⚠️ ${w}`).join("\n>\n"), "");
    }
    for (const g of c.guidance) lines.push(`- ${g}`);
    lines.push("", "<details><summary>Files</summary>", "");
    for (const f of c.files) lines.push(`- \`${f}\``);
    lines.push("", "</details>", "");
  }

  return lines.join("\n");
}
