import { NotFoundError } from "@anthropic-ai/sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { buildAgentConfig } from "./agentConfig";
import { buildEnvironmentConfig } from "./environmentConfig";
import { ensureRigProvisioning, getRigProvisioning } from "./rigProvisioning";
import { createTestDb } from "./tools/testDb";

type LiveAgent = Anthropic.Beta.Agents.BetaManagedAgentsAgent;
type LiveEnvironment = Anthropic.Beta.Environments.BetaEnvironment;

// Shaped exactly like buildAgentConfig()'s output, plus the server-assigned
// fields a real agents.create/retrieve response carries — same pattern as
// agentConvergence.test.ts's matchingLiveAgent().
function matchingLiveAgent(overrides: Partial<LiveAgent> = {}): LiveAgent {
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
    id: "agent_live",
    archived_at: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    description: null,
    mcp_servers: [],
    metadata: {},
    multiagent: null,
    version: 1,
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
      ...customTools.map(
        (tool): Extract<LiveAgent["tools"][number], { type: "custom" }> => ({
          type: "custom",
          name: tool.name,
          description: tool.description,
          input_schema: tool.input_schema,
        }),
      ),
    ],
    ...overrides,
  };
}

// Same pattern as environmentConvergence.test.ts's matchingLiveEnvironment().
function matchingLiveEnvironment(
  overrides: Partial<LiveEnvironment> = {},
): LiveEnvironment {
  const config = buildEnvironmentConfig();
  const desiredConfig = config.config;
  if (
    desiredConfig?.type !== "cloud" ||
    desiredConfig.networking?.type !== "limited"
  ) {
    throw new Error("expected a cloud config with limited networking");
  }

  return {
    id: "env_live",
    archived_at: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    metadata: {},
    name: config.name,
    description: config.description ?? "",
    type: "environment",
    config: {
      type: "cloud",
      networking: {
        type: "limited",
        allow_mcp_servers: desiredConfig.networking.allow_mcp_servers ?? false,
        allow_package_managers:
          desiredConfig.networking.allow_package_managers ?? false,
        allowed_hosts: desiredConfig.networking.allowed_hosts ?? [],
      },
      packages: {
        apt: desiredConfig.packages?.apt ?? [],
        cargo: desiredConfig.packages?.cargo ?? [],
        gem: desiredConfig.packages?.gem ?? [],
        go: desiredConfig.packages?.go ?? [],
        npm: desiredConfig.packages?.npm ?? [],
        pip: desiredConfig.packages?.pip ?? [],
      },
    },
    ...overrides,
  };
}

function makeNotFoundError(message: string): NotFoundError {
  return new NotFoundError(
    404,
    { type: "error", error: { type: "not_found_error", message } },
    undefined,
    new Headers(),
  );
}

function makeFakeClient(overrides: {
  agentsCreate?: ReturnType<typeof vi.fn>;
  agentsRetrieve?: ReturnType<typeof vi.fn>;
  agentsUpdate?: ReturnType<typeof vi.fn>;
  environmentsCreate?: ReturnType<typeof vi.fn>;
  environmentsRetrieve?: ReturnType<typeof vi.fn>;
  environmentsUpdate?: ReturnType<typeof vi.fn>;
}): Anthropic {
  return {
    beta: {
      agents: {
        create:
          overrides.agentsCreate ??
          vi.fn().mockResolvedValue(matchingLiveAgent()),
        retrieve:
          overrides.agentsRetrieve ??
          vi.fn().mockResolvedValue(matchingLiveAgent()),
        update:
          overrides.agentsUpdate ??
          vi.fn().mockResolvedValue(matchingLiveAgent()),
      },
      environments: {
        create:
          overrides.environmentsCreate ??
          vi.fn().mockResolvedValue(matchingLiveEnvironment()),
        retrieve:
          overrides.environmentsRetrieve ??
          vi.fn().mockResolvedValue(matchingLiveEnvironment()),
        update:
          overrides.environmentsUpdate ??
          vi.fn().mockResolvedValue(matchingLiveEnvironment()),
      },
    },
  } as unknown as Anthropic;
}

describe("ensureRigProvisioning", () => {
  let db: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  it("creates a fresh agent and environment on first run, with no existing row", async () => {
    const agentsCreate = vi
      .fn()
      .mockResolvedValue(matchingLiveAgent({ id: "agent_fresh", version: 1 }));
    const environmentsCreate = vi
      .fn()
      .mockResolvedValue(matchingLiveEnvironment({ id: "env_fresh" }));
    const client = makeFakeClient({ agentsCreate, environmentsCreate });

    const result = await ensureRigProvisioning(client, db);

    expect(result).toEqual({
      agentId: "agent_fresh",
      agentVersion: 1,
      environmentId: "env_fresh",
    });
    expect(agentsCreate).toHaveBeenCalledTimes(1);
    expect(environmentsCreate).toHaveBeenCalledTimes(1);

    const stored = await getRigProvisioning(db);
    expect(stored).toEqual(result);
  });

  it("skips agents.update/environments.update when the live resources already match config", async () => {
    const agentsRetrieve = vi
      .fn()
      .mockResolvedValue(
        matchingLiveAgent({ id: "agent_existing", version: 2 }),
      );
    const environmentsRetrieve = vi
      .fn()
      .mockResolvedValue(matchingLiveEnvironment({ id: "env_existing" }));
    const agentsUpdate = vi.fn();
    const environmentsUpdate = vi.fn();
    const client = makeFakeClient({
      agentsRetrieve,
      environmentsRetrieve,
      agentsUpdate,
      environmentsUpdate,
    });

    await db.rigProvisioning.create({
      data: {
        id: "rig",
        agentId: "agent_existing",
        agentVersion: 1,
        environmentId: "env_existing",
      },
    });

    const result = await ensureRigProvisioning(client, db);

    expect(result).toEqual({
      agentId: "agent_existing",
      agentVersion: 2,
      environmentId: "env_existing",
    });
    expect(agentsUpdate).not.toHaveBeenCalled();
    expect(environmentsUpdate).not.toHaveBeenCalled();
  });

  it("converges a changed agent/environment via update, keeping the same ids", async () => {
    const changedAgent = matchingLiveAgent({
      id: "agent_existing",
      version: 1,
      name: "Something Else",
    });
    const changedEnvironment = matchingLiveEnvironment({
      id: "env_existing",
      description: "different",
    });
    const agentsRetrieve = vi.fn().mockResolvedValue(changedAgent);
    const environmentsRetrieve = vi.fn().mockResolvedValue(changedEnvironment);
    const agentsUpdate = vi
      .fn()
      .mockResolvedValue(
        matchingLiveAgent({ id: "agent_existing", version: 2 }),
      );
    const environmentsUpdate = vi
      .fn()
      .mockResolvedValue(matchingLiveEnvironment({ id: "env_existing" }));
    const client = makeFakeClient({
      agentsRetrieve,
      environmentsRetrieve,
      agentsUpdate,
      environmentsUpdate,
    });

    await db.rigProvisioning.create({
      data: {
        id: "rig",
        agentId: "agent_existing",
        agentVersion: 1,
        environmentId: "env_existing",
      },
    });

    const result = await ensureRigProvisioning(client, db);

    expect(result).toEqual({
      agentId: "agent_existing",
      agentVersion: 2,
      environmentId: "env_existing",
    });
    expect(agentsUpdate).toHaveBeenCalledTimes(1);
    expect(environmentsUpdate).toHaveBeenCalledTimes(1);
  });

  it("recreates the agent when the stored agentId no longer resolves (NotFoundError)", async () => {
    const agentsRetrieve = vi
      .fn()
      .mockRejectedValue(makeNotFoundError("Agent not found: agent_gone"));
    const agentsCreate = vi
      .fn()
      .mockResolvedValue(matchingLiveAgent({ id: "agent_new", version: 1 }));
    const environmentsRetrieve = vi
      .fn()
      .mockResolvedValue(matchingLiveEnvironment({ id: "env_existing" }));
    const client = makeFakeClient({
      agentsRetrieve,
      agentsCreate,
      environmentsRetrieve,
    });

    await db.rigProvisioning.create({
      data: {
        id: "rig",
        agentId: "agent_gone",
        agentVersion: 1,
        environmentId: "env_existing",
      },
    });

    const result = await ensureRigProvisioning(client, db);

    expect(result).toEqual({
      agentId: "agent_new",
      agentVersion: 1,
      environmentId: "env_existing",
    });
    expect(agentsCreate).toHaveBeenCalledTimes(1);

    const stored = await getRigProvisioning(db);
    expect(stored?.agentId).toBe("agent_new");
  });

  it("recreates the environment when the stored environmentId no longer resolves (NotFoundError)", async () => {
    const environmentsRetrieve = vi
      .fn()
      .mockRejectedValue(makeNotFoundError("Environment not found: env_gone"));
    const environmentsCreate = vi
      .fn()
      .mockResolvedValue(matchingLiveEnvironment({ id: "env_new" }));
    const agentsRetrieve = vi
      .fn()
      .mockResolvedValue(
        matchingLiveAgent({ id: "agent_existing", version: 1 }),
      );
    const client = makeFakeClient({
      agentsRetrieve,
      environmentsRetrieve,
      environmentsCreate,
    });

    await db.rigProvisioning.create({
      data: {
        id: "rig",
        agentId: "agent_existing",
        agentVersion: 1,
        environmentId: "env_gone",
      },
    });

    const result = await ensureRigProvisioning(client, db);

    expect(result).toEqual({
      agentId: "agent_existing",
      agentVersion: 1,
      environmentId: "env_new",
    });
    expect(environmentsCreate).toHaveBeenCalledTimes(1);
  });

  it("propagates an error that isn't NotFoundError instead of masking it as recovery", async () => {
    const agentsRetrieve = vi.fn().mockRejectedValue(new Error("network blip"));
    const client = makeFakeClient({ agentsRetrieve });

    await db.rigProvisioning.create({
      data: {
        id: "rig",
        agentId: "agent_existing",
        agentVersion: 1,
        environmentId: "env_existing",
      },
    });

    await expect(ensureRigProvisioning(client, db)).rejects.toThrow(
      "network blip",
    );
  });
});

describe("getRigProvisioning", () => {
  let db: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  it("returns null before ensureRigProvisioning has ever run", async () => {
    expect(await getRigProvisioning(db)).toBeNull();
  });
});
