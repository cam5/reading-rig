import type Anthropic from "@anthropic-ai/sdk";

/**
 * Whether a live agent already matches the config `buildAgentConfig()`
 * would send. Lets `scripts/setup-agent.ts` skip a no-op `agents.update`
 * instead of relying on the API to no-op it server-side — the SDK's own
 * type doc says version "increments when the agent is modified", implying
 * an unchanged update wouldn't bump it, but that's unverified against the
 * real API (see setup-agent.ts's network-path caveat), so we don't lean on
 * it.
 *
 * Deliberately best-effort: only compares fields `buildAgentConfig()`
 * actually sets (name, model, system, and the specific tools it
 * configures). Server-resolved fields we never set ourselves — tool
 * `permission_policy`, the other five tools' resolved state — are left out
 * because their resolved shape isn't known without a live call either.
 * Reporting "changed" when nothing meaningful did just costs one redundant
 * update; missing a real change and leaving a stale agent live is the
 * failure worth avoiding, so this errs toward false negatives (says
 * "changed") rather than false positives.
 */
export function agentMatchesConfig(
  current: Anthropic.Beta.Agents.BetaManagedAgentsAgent,
  desired: Anthropic.Beta.Agents.AgentCreateParams,
): boolean {
  return (
    current.name === desired.name &&
    modelId(current.model) === modelId(desired.model) &&
    (current.system ?? null) === (desired.system ?? null) &&
    toolsetMatches(current.tools, desired.tools)
  );
}

function modelId(
  model: Anthropic.Beta.Agents.BetaManagedAgentsAgent["model"] | Anthropic.Beta.Agents.AgentCreateParams["model"],
): string | undefined {
  return typeof model === "string" ? model : model?.id;
}

function toolsetMatches(
  current: Anthropic.Beta.Agents.BetaManagedAgentsAgent["tools"],
  desired: Anthropic.Beta.Agents.AgentCreateParams["tools"],
): boolean {
  if (current.length !== 1 || desired?.length !== 1) return false;

  const [currentToolset] = current;
  const [desiredToolset] = desired;
  if (currentToolset.type !== "agent_toolset_20260401" || desiredToolset.type !== "agent_toolset_20260401") {
    return false;
  }

  if ((currentToolset.default_config.enabled ?? true) !== (desiredToolset.default_config?.enabled ?? true)) {
    return false;
  }

  return (desiredToolset.configs ?? []).every((wanted) => {
    const live = currentToolset.configs.find((tool) => tool.name === wanted.name);
    return live !== undefined && live.enabled === (wanted.enabled ?? true);
  });
}
