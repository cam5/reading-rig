import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// This runs as part of `npm start`, inside the actual runtime container —
// NOT Railway's `deploy.preDeployCommand`. Railway's pre-deploy commands
// run in a separate container with no volume access at all, in any
// environment (confirmed against the live reading-rig-pr-88 PR
// environment: preDeployCommand ran migrate+seed+ingest successfully, but
// the running container's own /data/data.db still had no tables, since
// none of that work landed on the volume actually mounted into it).
// PR environments' volumes are already meant to be treated as disposable
// (see isEphemeralRailwayDeploy below) — the point this proved isn't about
// PR environments specifically, it's that preDeployCommand can't reach a
// mounted volume at all, which would have broken prod's persistent one
// identically. Migrations touching the volume have to happen here, in the
// container that has it mounted.
//
// This reintroduces the *shape* of the original incident (a failure here
// happens inside the container that's about to serve traffic) but not the
// two things that made it a full outage: `db push`'s live, unreviewed diff
// is gone (replaced by committed, reviewed migrations — see MIGRATIONS.md),
// and railway.toml caps retries low and gates traffic on /healthz, so
// Railway keeps the previous deployment serving until this container
// either passes its healthcheck or exhausts its (few, fast) retries.
//
// PR environments (and staging-qa) redeploy that same volume on every push
// and have nothing worth keeping: seed + ingest below recreate the fixed
// seed user, both fixture books, and the seed library idempotently every
// run. This used to
// key off RAILWAY_GIT_BRANCH (non-main => ephemeral), but that var is only
// injected for auto-generated PR environments — staging-qa is a persistent,
// manually-deployed environment with no RAILWAY_GIT_BRANCH at all, so it
// silently fell through to the "prod" branch below and booted with an
// empty, unseeded database (P2025 on every request). RAILWAY_ENVIRONMENT_NAME
// is injected for every Railway deploy (absent locally and in CI), so
// keying off "every environment except production" covers PR environments
// and staging-qa uniformly and never touches prod or a developer's own
// dev.db.
const environmentName = process.env.RAILWAY_ENVIRONMENT_NAME;
const isEphemeralRailwayDeploy =
  Boolean(environmentName) && environmentName !== "production";

if (isEphemeralRailwayDeploy) {
  // Prisma 7 dropped --skip-generate from `migrate reset` (only -f/--force,
  // --schema, --config remain) — this is unavoidably a full reset+generate
  // now, harmless here since generate is fast and already ran once in the
  // build step.
  run("prisma", ["migrate", "reset", "--force"]);
  run("tsx", ["prisma/seed.ts"]);
  run("tsx", [
    "scripts/ingest.ts",
    "app/domain/epub/__fixtures__/capital-volume-i.epub",
  ]);
  run("tsx", [
    "scripts/ingest.ts",
    "app/domain/epub/__fixtures__/pride-and-prejudice.epub",
  ]);
  run("tsx", ["scripts/seedLibrary.ts"]);
} else {
  // Prod (and local, if invoked directly): apply only committed, already-
  // reviewed migrations. No re-seed/re-ingest on every release — the
  // production database already has real data, unlike a PR environment's
  // throwaway volume.
  deployMigrations();
}

// Converges the Managed Agent onto scripts/setup-agent.ts's current output
// on every deploy — prod and PR environments alike, no separate promotion
// step. Soft-skips rather than failing the release when ANTHROPIC_API_KEY
// isn't set for this environment: M3 ("The Rig") is paused pending M1, so
// no environment is required to have the key configured yet, and a missing
// key here shouldn't block unrelated deploys the way a real setup-agent
// failure should (that still fails the release below, same as a migration
// failure would — Railway's healthcheck-gated rollout keeps the previous
// deployment serving until it either passes or exhausts its retries).
if (process.env.ANTHROPIC_API_KEY) {
  run("tsx", ["scripts/setup-agent.ts"]);
} else {
  console.log(
    "ANTHROPIC_API_KEY not set for this environment; skipping agent convergence.",
  );
}

function run(command: string, args: string[]) {
  execSync([command, ...args].join(" "), { stdio: "inherit" });
}

// `migrate deploy` fails with P3005 the first time it runs against a
// database whose tables predate `prisma/migrations/` entirely — the exact
// state prod was in the moment this repo switched off `db push` (see
// MIGRATIONS.md's "Baselining" section). Prisma's own fix for that is
// `migrate resolve --applied <migration>`, which only writes to the
// `_prisma_migrations` bookkeeping table — no schema or data changes. This
// runs that automatically, once, so a fresh un-baselined target (prod
// today, or any future restore-from-backup scenario) heals itself inside
// the normal boot path instead of needing a manual SSH session. It assumes
// the target schema already matches `prisma/schema.prisma` at the baseline
// migration — true for any database that was still on `db push` up to the
// moment of baselining, which is the only case P3005 can fire for here.
function deployMigrations() {
  const first = runCaptured("prisma", ["migrate", "deploy"]);
  if (first.status === 0) return;
  if (!first.output.includes("P3005")) {
    process.exit(first.status);
  }

  const baseline = earliestMigrationName();
  console.log(
    `prisma migrate deploy failed with P3005 (unbaselined non-empty schema) — resolving "${baseline}" as already applied, then retrying.`,
  );
  run("prisma", ["migrate", "resolve", "--applied", baseline]);
  run("prisma", ["migrate", "deploy"]);
}

function earliestMigrationName(): string {
  const migrationsDir = path.join(
    import.meta.dirname,
    "..",
    "prisma",
    "migrations",
  );
  const [earliest] = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!earliest) {
    throw new Error(
      `No migrations found in ${migrationsDir} to resolve as baseline`,
    );
  }
  return earliest;
}

function runCaptured(
  command: string,
  args: string[],
): { status: number; output: string } {
  try {
    const output = execSync([command, ...args].join(" "), {
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
    process.stdout.write(output);
    return { status: 0, output };
  } catch (err) {
    const e = err as {
      status?: number | null;
      stdout?: Buffer;
      stderr?: Buffer;
    };
    const output = `${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`;
    process.stdout.write(output);
    return { status: e.status ?? 1, output };
  }
}
