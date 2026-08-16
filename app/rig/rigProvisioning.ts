import { NotFoundError } from "@anthropic-ai/sdk";
import type Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "../../generated/prisma/client";
import { agentMatchesConfig } from "./agentConvergence";
import { buildAgentConfig } from "./agentConfig";
import { environmentMatchesConfig } from "./environmentConvergence";
import { buildEnvironmentConfig } from "./environmentConfig";

const PROVISIONING_ID = "rig";

export type RigProvisioning = {
  agentId: string;
  agentVersion: number;
  environmentId: string;
};

/**
 * Reads the Rig's current agent/environment ids from the DB — the
 * singleton row `ensureRigProvisioning` writes. Null before the first ever
 * `ensureRigProvisioning` call (a brand-new database).
 */
export async function getRigProvisioning(
  db: PrismaClient,
): Promise<RigProvisioning | null> {
  const row = await db.rigProvisioning.findUnique({
    where: { id: PROVISIONING_ID },
  });
  return row
    ? {
        agentId: row.agentId,
        agentVersion: row.agentVersion,
        environmentId: row.environmentId,
      }
    : null;
}

/**
 * Converges the Rig's Anthropic agent + environment onto
 * `buildAgentConfig()`/`buildEnvironmentConfig()`'s current output —
 * creating both fresh if there's no DB row yet, or if the ids on file no
 * longer resolve on Anthropic's side (`NotFoundError` on retrieve) — and
 * persists the result. One function now serves three callers that used to
 * be separate concerns: `scripts/setup-agent.ts`'s first-run bootstrap,
 * its steady-state deploy-time convergence, and
 * `anthropicSessionClient.ts`'s request-time self-heal, on discovering the
 * agent or environment itself is gone (#113's actual root cause — see the
 * RigProvisioning model's doc comment). The "retrieve, else create fresh"
 * fallback each of `updateExistingAgent`/`updateExistingEnvironment`
 * already had makes recovery and convergence the same code path rather
 * than two.
 */
export async function ensureRigProvisioning(
  client: Anthropic,
  db: PrismaClient,
): Promise<RigProvisioning> {
  const existing = await getRigProvisioning(db);

  const agentConfig = buildAgentConfig();
  const agent = existing
    ? await updateExistingAgent(client, existing.agentId, agentConfig)
    : await createAgent(client, agentConfig);

  const environmentConfig = buildEnvironmentConfig();
  const environment = existing
    ? await updateExistingEnvironment(
        client,
        existing.environmentId,
        environmentConfig,
      )
    : await createEnvironment(client, environmentConfig);

  const row = await db.rigProvisioning.upsert({
    where: { id: PROVISIONING_ID },
    create: {
      id: PROVISIONING_ID,
      agentId: agent.id,
      agentVersion: agent.version,
      environmentId: environment.id,
    },
    update: {
      agentId: agent.id,
      agentVersion: agent.version,
      environmentId: environment.id,
    },
  });

  return {
    agentId: row.agentId,
    agentVersion: row.agentVersion,
    environmentId: row.environmentId,
  };
}

function createAgent(
  client: Anthropic,
  config: Anthropic.Beta.Agents.AgentCreateParams,
) {
  return client.beta.agents.create(config);
}

async function updateExistingAgent(
  client: Anthropic,
  id: string,
  config: Anthropic.Beta.Agents.AgentCreateParams,
) {
  try {
    const current = await client.beta.agents.retrieve(id);
    if (agentMatchesConfig(current, config)) {
      console.log(
        `Agent "${current.name}" (${current.id}) already matches; skipping update.`,
      );
      return current;
    }
    return await client.beta.agents.update(id, config);
  } catch (error) {
    if (error instanceof NotFoundError) {
      // The stored agentId doesn't resolve to a live agent — deleted,
      // wrong workspace, or stale. Create fresh rather than failing.
      console.warn(
        `RigProvisioning.agentId=${id} was not found; creating a new agent instead.`,
      );
      return createAgent(client, config);
    }
    throw error;
  }
}

function createEnvironment(
  client: Anthropic,
  config: Anthropic.Beta.Environments.EnvironmentCreateParams,
) {
  return client.beta.environments.create(config);
}

async function updateExistingEnvironment(
  client: Anthropic,
  id: string,
  config: Anthropic.Beta.Environments.EnvironmentCreateParams,
) {
  try {
    const current = await client.beta.environments.retrieve(id);
    if (environmentMatchesConfig(current, config)) {
      console.log(
        `Environment "${current.name}" (${current.id}) already matches; skipping update.`,
      );
      return current;
    }
    return await client.beta.environments.update(id, config);
  } catch (error) {
    if (error instanceof NotFoundError) {
      // Same reasoning as the agent side above.
      console.warn(
        `RigProvisioning.environmentId=${id} was not found; creating a new environment instead.`,
      );
      return createEnvironment(client, config);
    }
    throw error;
  }
}
