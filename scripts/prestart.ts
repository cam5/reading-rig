import { execSync } from "node:child_process";

// Railway persists the SQLite file on a volume across deploys, so a plain
// `db push` refuses schema changes it can't safely apply to existing rows
// (e.g. a new required column) — see the "ownerId" crash-loop this fixed.
// PR environments redeploy that same volume on every pushed commit and have
// nothing worth keeping: seed + ingest below recreate the fixed seed user
// and both fixture books idempotently every run. RAILWAY_GIT_BRANCH is
// injected automatically by Railway (absent locally and in CI), so this
// only resets on non-main Railway deploys — i.e. PR environments — and
// never touches production or a developer's own dev.db.
const branch = process.env.RAILWAY_GIT_BRANCH;
const isEphemeralRailwayDeploy = Boolean(branch) && branch !== "main";
const pushArgs = isEphemeralRailwayDeploy ? ["db", "push", "--force-reset", "--accept-data-loss"] : ["db", "push"];

run("prisma", pushArgs);
run("tsx", ["prisma/seed.ts"]);
run("tsx", ["scripts/ingest.ts", "app/domain/epub/__fixtures__/capital-volume-i.epub"]);
run("tsx", ["scripts/ingest.ts", "app/domain/epub/__fixtures__/pride-and-prejudice.epub"]);

function run(command: string, args: string[]) {
  execSync([command, ...args].join(" "), { stdio: "inherit" });
}
