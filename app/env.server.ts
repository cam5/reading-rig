// Railway injects RAILWAY_ENVIRONMENT_NAME for every deploy — "production"
// for the real deploy, anything else (a PR environment's branch name,
// "staging-qa") for a non-prod one, and unset entirely on a developer's own
// machine or a GitHub Actions runner. Keying off "named exactly production"
// rather than "the var exists" covers local dev and CI (unset) and PR
// environments/staging-qa (set, but not "production") with one check — see
// scripts/release.ts's isEphemeralRailwayDeploy, which reads the same var
// for the same reason when deciding whether a deploy reseeds its database.
export function isProductionEnvironment(): boolean {
  return process.env.RAILWAY_ENVIRONMENT_NAME === "production";
}
