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
  model:
    | Anthropic.Beta.Agents.BetaManagedAgentsAgent["model"]
    | Anthropic.Beta.Agents.AgentCreateParams["model"],
): string | undefined {
  return typeof model === "string" ? model : model?.id;
}

/**
 * Every entry `desired` declares must have a matching entry live — checked
 * per-type rather than requiring the arrays to line up 1:1, since
 * `buildAgentConfig()`'s tools array now mixes the one prebuilt toolset
 * with however many custom tools (one today, more as #25's other handlers
 * get wired). Extra live entries `desired` doesn't mention are ignored,
 * same asymmetry the prebuilt-toolset check already had (a live tool
 * config we don't set ourselves isn't a mismatch).
 */
function toolsetMatches(
  current: Anthropic.Beta.Agents.BetaManagedAgentsAgent["tools"],
  desired: Anthropic.Beta.Agents.AgentCreateParams["tools"],
): boolean {
  return (desired ?? []).every((wantedTool) => {
    if (wantedTool.type === "agent_toolset_20260401") {
      const liveToolset = current.find(
        (tool) => tool.type === "agent_toolset_20260401",
      );
      return (
        liveToolset !== undefined &&
        liveToolset.type === "agent_toolset_20260401" &&
        prebuiltToolsetMatches(liveToolset, wantedTool)
      );
    }

    if (wantedTool.type === "custom") {
      const liveTool = current.find(
        (tool) => tool.type === "custom" && tool.name === wantedTool.name,
      );
      return (
        liveTool !== undefined &&
        liveTool.type === "custom" &&
        liveTool.description === wantedTool.description &&
        JSON.stringify(liveTool.input_schema) ===
          JSON.stringify(wantedTool.input_schema)
      );
    }

    // MCP toolsets aren't something buildAgentConfig() produces today.
    return false;
  });
}

function prebuiltToolsetMatches(
  current: Anthropic.Beta.Agents.BetaManagedAgentsAgentToolset20260401,
  desired: Anthropic.Beta.Agents.BetaManagedAgentsAgentToolset20260401Params,
): boolean {
  if (
    (current.default_config.enabled ?? true) !==
    (desired.default_config?.enabled ?? true)
  ) {
    return false;
  }

  return (desired.configs ?? []).every((wanted) => {
    const live = current.configs.find((tool) => tool.name === wanted.name);
    return live !== undefined && live.enabled === (wanted.enabled ?? true);
  });
}
