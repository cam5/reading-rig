import type Anthropic from "@anthropic-ai/sdk";

/**
 * Whether a live environment already matches the config
 * `buildEnvironmentConfig()` would send — same purpose as
 * agentConvergence.ts's agentMatchesConfig, so scripts/setup-agent.ts can
 * skip a no-op `environments.update`. Deliberately best-effort and scoped to
 * only the fields buildEnvironmentConfig() actually sets (name, description,
 * and the cloud config's networking/packages); errs toward false negatives
 * rather than false positives, same reasoning as the agent side.
 */
export function environmentMatchesConfig(
  current: Anthropic.Beta.Environments.BetaEnvironment,
  desired: Anthropic.Beta.Environments.EnvironmentCreateParams,
): boolean {
  return (
    current.name === desired.name &&
    (current.description ?? "") === (desired.description ?? "") &&
    cloudConfigMatches(current.config, desired.config)
  );
}

function cloudConfigMatches(
  current: Anthropic.Beta.Environments.BetaEnvironment["config"],
  desired: Anthropic.Beta.Environments.EnvironmentCreateParams["config"],
): boolean {
  if (current.type !== "cloud" || desired?.type !== "cloud") {
    return current.type === desired?.type;
  }

  return networkingMatches(current.networking, desired.networking) && packagesMatch(current.packages, desired.packages);
}

function networkingMatches(
  current: Anthropic.Beta.Environments.BetaCloudConfig["networking"],
  desired: Anthropic.Beta.Environments.BetaCloudConfigParams["networking"],
): boolean {
  if (!desired || current.type !== desired.type) return false;
  if (current.type !== "limited" || desired.type !== "limited") return true;

  return (
    current.allow_mcp_servers === (desired.allow_mcp_servers ?? false) &&
    current.allow_package_managers === (desired.allow_package_managers ?? false) &&
    sameEntries(current.allowed_hosts, desired.allowed_hosts ?? [])
  );
}

function sameEntries(current: string[], desired: string[]): boolean {
  if (current.length !== desired.length) return false;
  const sortedCurrent = [...current].sort();
  const sortedDesired = [...desired].sort();
  return sortedCurrent.every((entry, index) => entry === sortedDesired[index]);
}

function packagesMatch(
  current: Anthropic.Beta.Environments.BetaPackages,
  desired: Anthropic.Beta.Environments.BetaPackagesParams | null | undefined,
): boolean {
  const managers = ["apt", "cargo", "gem", "go", "npm", "pip"] as const;
  return managers.every((manager) => sameEntries(current[manager], desired?.[manager] ?? []));
}
