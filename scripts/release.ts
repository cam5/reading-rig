import { execSync } from "node:child_process";

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
// PR environments redeploy that same volume on every pushed commit and have
// nothing worth keeping: seed + ingest below recreate the fixed seed user
// and both fixture books idempotently every run. RAILWAY_GIT_BRANCH is
// injected automatically by Railway (absent locally and in CI), so this
// only resets on non-main Railway deploys — i.e. PR environments — and
// never touches production or a developer's own dev.db.
const branch = process.env.RAILWAY_GIT_BRANCH;
const isEphemeralRailwayDeploy = Boolean(branch) && branch !== "main";

if (isEphemeralRailwayDeploy) {
  // Prisma 7 dropped --skip-generate from `migrate reset` (only -f/--force,
  // --schema, --config remain) — this is unavoidably a full reset+generate
  // now, harmless here since generate is fast and already ran once in the
  // build step.
  run("prisma", ["migrate", "reset", "--force"]);
  run("tsx", ["prisma/seed.ts"]);
  run("tsx", ["scripts/ingest.ts", "app/domain/epub/__fixtures__/capital-volume-i.epub"]);
  run("tsx", ["scripts/ingest.ts", "app/domain/epub/__fixtures__/pride-and-prejudice.epub"]);
} else {
  // Prod (and local, if invoked directly): apply only committed, already-
  // reviewed migrations. No re-seed/re-ingest on every release — the
  // production database already has real data, unlike a PR environment's
  // throwaway volume.
  run("prisma", ["migrate", "deploy"]);
}

function run(command: string, args: string[]) {
  execSync([command, ...args].join(" "), { stdio: "inherit" });
}
