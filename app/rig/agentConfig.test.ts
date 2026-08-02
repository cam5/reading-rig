import { describe, expect, it } from "vitest";
import { AGENT_MODEL, AGENT_NAME, buildAgentConfig, buildSystemPrompt } from "./agentConfig";

describe("buildAgentConfig", () => {
  it("names the agent and pins the model the skill defaults to", () => {
    const config = buildAgentConfig();
    expect(config.name).toBe(AGENT_NAME);
    expect(config.model).toBe(AGENT_MODEL);
    expect(config.model).toBe("claude-opus-4-7");
  });

  it("disables the prebuilt toolset by default", () => {
    const [toolset] = buildAgentConfig().tools ?? [];
    expect(toolset).toMatchObject({
      type: "agent_toolset_20260401",
      default_config: { enabled: false },
    });
  });

  it("re-enables only web_search and web_fetch", () => {
    const [toolset] = buildAgentConfig().tools ?? [];
    if (!toolset || toolset.type !== "agent_toolset_20260401") {
      throw new Error("expected the agent toolset config");
    }

    const enabledNames = (toolset.configs ?? [])
      .filter((tool) => tool.enabled)
      .map((tool) => tool.name)
      .sort();

    expect(enabledNames).toEqual(["web_fetch", "web_search"]);
  });

  it("does not configure bash, read, write, edit, glob, or grep", () => {
    const [toolset] = buildAgentConfig().tools ?? [];
    if (!toolset || toolset.type !== "agent_toolset_20260401") {
      throw new Error("expected the agent toolset config");
    }

    const configuredNames = (toolset.configs ?? []).map((tool) => tool.name);
    expect(configuredNames).toEqual(["web_search", "web_fetch"]);
  });

  it("declares only the one toolset — no custom tools yet", () => {
    expect(buildAgentConfig().tools).toHaveLength(1);
  });
});

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt();

  it("states the read-only invariant: the Rig never writes to the margin", () => {
    expect(prompt).toMatch(/do not write to the reader's commonplace book/i);
  });

  it("frames itself as one direct response, not a set of modes to invoke", () => {
    expect(prompt).toMatch(/not a set of modes to invoke/i);
  });

  it("keeps the quiet, literary voice: no exclamation marks", () => {
    expect(prompt).not.toMatch(/!/);
  });
});
