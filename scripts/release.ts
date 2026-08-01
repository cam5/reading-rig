import { execSync } from "node:child_process";

// Railway persists the SQLite file on a volume across deploys. This used to
// run as an npm `prestart` lifecycle hook, coupled to `npm start` — a
// rejected `db push` happened *inside* the container that was supposed to
// start serving traffic, so Railway crash-looped it (10 retries, ~4min
// outage) instead of just failing the deploy. Wired in as Railway's
// `deploy.preDeployCommand` (see railway.toml) instead: it runs once before
// the new instance takes traffic, and a failure here blocks the deploy
// while the previous instance keeps serving.
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
