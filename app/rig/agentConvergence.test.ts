import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { agentMatchesConfig } from "./agentConvergence";
import { buildAgentConfig } from "./agentConfig";

type LiveAgent = Anthropic.Beta.Agents.BetaManagedAgentsAgent;
type LiveToolset = Anthropic.Beta.Agents.BetaManagedAgentsAgentToolset20260401;
type LiveCustomTool = Anthropic.Beta.Agents.BetaManagedAgentsCustomTool;

function toolsetOf(live: LiveAgent): LiveToolset {
  const toolset = live.tools.find(
    (tool) => tool.type === "agent_toolset_20260401",
  );
  if (!toolset) {
    throw new Error("expected the agent toolset config");
  }
  return toolset;
}

function customToolOf(live: LiveAgent, name: string): LiveCustomTool {
  const tool = live.tools.find(
    (tool) => tool.type === "custom" && tool.name === name,
  );
  if (!tool || tool.type !== "custom") {
    throw new Error(`expected a custom tool named ${name}`);
  }
  return tool;
}

// A live agent shaped exactly like buildAgentConfig()'s output, plus the
// server-assigned fields a real `agents.retrieve`/`create` response carries.
function matchingLiveAgent(): LiveAgent {
  const config = buildAgentConfig();
  const toolset = config.tools?.find(
    (tool) => tool.type === "agent_toolset_20260401",
  );
  if (!toolset) {
    throw new Error("expected the agent toolset config");
  }
  const customTools = (config.tools ?? []).filter(
    (tool) => tool.type === "custom",
  );

  return {
    id: "agent_test",
    archived_at: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    description: null,
    mcp_servers: [],
    metadata: {},
    multiagent: null,
    version: 3,
    name: config.name!,
    model: { id: config.model as Anthropic.Beta.Agents.BetaManagedAgentsModel },
    system: config.system ?? null,
    skills: [],
    type: "agent",
    tools: [
      {
        type: "agent_toolset_20260401",
        default_config: {
          enabled: toolset.default_config?.enabled ?? true,
          permission_policy: { type: "always_allow" },
        },
        configs: (toolset.configs ?? []).map((tool) => ({
          name: tool.name,
          enabled: tool.enabled ?? true,
          permission_policy: { type: "always_allow" },
        })),
      },
      ...customTools.map((tool): LiveCustomTool => ({
        type: "custom",
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
      })),
    ],
  };
}

describe("agentMatchesConfig", () => {
  it("matches an unchanged agent", () => {
    expect(agentMatchesConfig(matchingLiveAgent(), buildAgentConfig())).toBe(
      true,
    );
  });

  it("ignores server-resolved fields buildAgentConfig() never sets, like permission_policy", () => {
    const live = matchingLiveAgent();
    toolsetOf(live).default_config.permission_policy = { type: "always_ask" };
    expect(agentMatchesConfig(live, buildAgentConfig())).toBe(true);
  });

  it("detects a name change", () => {
    const live = matchingLiveAgent();
    live.name = "Something Else";
    expect(agentMatchesConfig(live, buildAgentConfig())).toBe(false);
  });

  it("detects a model change", () => {
    const live = matchingLiveAgent();
    live.model = { id: "claude-sonnet-5" };
    expect(agentMatchesConfig(live, buildAgentConfig())).toBe(false);
  });

  it("detects a system prompt change", () => {
    const live = matchingLiveAgent();
    live.system = "a different prompt entirely";
    expect(agentMatchesConfig(live, buildAgentConfig())).toBe(false);
  });

  it("detects a tool's enabled state changing", () => {
    const live = matchingLiveAgent();
    const toolset = toolsetOf(live);
    toolset.configs = toolset.configs.map((tool) =>
      tool.name === "web_search" ? { ...tool, enabled: false } : tool,
    );
    expect(agentMatchesConfig(live, buildAgentConfig())).toBe(false);
  });

  it("detects the default_config enabled flag changing", () => {
    const live = matchingLiveAgent();
    toolsetOf(live).default_config.enabled = true;
    // desired default_config.enabled is false — flip live to true, should now differ.
    expect(agentMatchesConfig(live, buildAgentConfig())).toBe(false);
  });

  it("detects a custom tool's description changing", () => {
    const live = matchingLiveAgent();
    customToolOf(live, "search_shelf").description = "a stale description";
    expect(agentMatchesConfig(live, buildAgentConfig())).toBe(false);
  });

  it("detects a custom tool's input_schema changing", () => {
    const live = matchingLiveAgent();
    customToolOf(live, "search_shelf").input_schema = {
      type: "object",
      properties: {},
    };
    expect(agentMatchesConfig(live, buildAgentConfig())).toBe(false);
  });
});
