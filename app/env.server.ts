// Railway injects RAILWAY_ENVIRONMENT_NAME for every deploy — "production"
// for the real deploy, "staging-qa" for the persistent QA environment, a PR
// environment's own name for those, and unset entirely on a developer's own
// machine or a GitHub Actions runner.
//
// staging-qa now sits behind its own public domain (staging.reading-rig.com)
// alongside production's reading-rig.com, so it needs the same real-auth
// guarantees production does: a real SESSION_SECRET and no seeded-user
// auto-login (app/auth/session.server.ts). PR environments stay exempt —
// they're Railway-generated *.up.railway.app URLs nobody outside this repo
// has, torn down when the PR closes.
//
// Distinct from scripts/release.ts's isEphemeralRailwayDeploy, which reads
// the same variable to decide whether a deploy resets/reseeds the database
// — that's about disposable *data*, not auth, and staging-qa stays
// ephemeral there: a real login on staging-qa still lands on a database of
// fixture books, not anything worth persisting.
const REAL_AUTH_ENVIRONMENTS = new Set(["production", "staging-qa"]);

export function requiresRealAuth(): boolean {
  const environmentName = process.env.RAILWAY_ENVIRONMENT_NAME;
  return (
    environmentName !== undefined && REAL_AUTH_ENVIRONMENTS.has(environmentName)
  );
}
