import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic, { NotFoundError } from "@anthropic-ai/sdk";
import { buildAgentConfig } from "../app/rig/agentConfig";
import { agentMatchesConfig } from "../app/rig/agentConvergence";
import { buildEnvironmentConfig } from "../app/rig/environmentConfig";
import { environmentMatchesConfig } from "../app/rig/environmentConvergence";
import { upsertEnvVar } from "../app/rig/envFile";

// Creates the Managed Agent and its environment once and stores their
// ids/version in .env. Never called in the request path — see the build
// plan's "One agent, created once" invariant. Re-running this script
// converges each existing resource onto its buildXConfig()'s current output
// (`POST /v1/agents/{id}` / `POST /v1/environments/{id}`, a new agent
// version) instead of creating a duplicate, skipping the call entirely if
// the live resource already matches. `scripts/release.ts` also runs this on
// every deploy (when ANTHROPIC_API_KEY is set for that environment), so a
// merged config change converges automatically without a manual re-run.
//
// NOTE: this network path has not been run against the real API. There is
// no ANTHROPIC_API_KEY in this environment yet, so `agents.create` /
// `agents.update`/`retrieve` and their `environments.*` counterparts are
// unverified beyond typechecking against the installed SDK's types.
// `buildAgentConfig()`/`agentMatchesConfig()` and
// `buildEnvironmentConfig()`/`environmentMatchesConfig()` — the parts that
// actually encode the scope of this ticket — have real Vitest coverage in
// app/rig/agentConfig.test.ts, app/rig/agentConvergence.test.ts,
// app/rig/environmentConfig.test.ts, and app/rig/environmentConvergence.test.ts.

const ENV_PATH = path.resolve(process.cwd(), ".env");
const AGENT_ID_KEY = "READING_RIG_AGENT_ID";
const AGENT_VERSION_KEY = "READING_RIG_AGENT_VERSION";
const ENVIRONMENT_ID_KEY = "READING_RIG_ENVIRONMENT_ID";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example), then re-run `npm run agent:setup`.",
    );
    process.exitCode = 1;
    return;
  }

  const client = new Anthropic();

  const agentConfig = buildAgentConfig();
  const existingAgentId = process.env[AGENT_ID_KEY];
  const agent = existingAgentId
    ? await updateExistingAgent(client, existingAgentId, agentConfig)
    : await createAgent(client, agentConfig);

  const environmentConfig = buildEnvironmentConfig();
  const existingEnvironmentId = process.env[ENVIRONMENT_ID_KEY];
  const environment = existingEnvironmentId
    ? await updateExistingEnvironment(client, existingEnvironmentId, environmentConfig)
    : await createEnvironment(client, environmentConfig);

  writeSetupEnv(agent.id, agent.version, environment.id);
  console.log(`Agent "${agent.name}" ready: ${agent.id} (version ${agent.version})`);
  console.log(`Environment "${environment.name}" ready: ${environment.id}`);
}

function createAgent(client: Anthropic, config: Anthropic.Beta.Agents.AgentCreateParams) {
  return client.beta.agents.create(config);
}

async function updateExistingAgent(client: Anthropic, id: string, config: Anthropic.Beta.Agents.AgentCreateParams) {
  try {
    const current = await client.beta.agents.retrieve(id);
    if (agentMatchesConfig(current, config)) {
      console.log(`Agent "${current.name}" (${current.id}) already matches; skipping update.`);
      return current;
    }
    return await client.beta.agents.update(id, config);
  } catch (error) {
    if (error instanceof NotFoundError) {
      // READING_RIG_AGENT_ID in .env doesn't resolve to a live agent —
      // deleted, wrong workspace, or a stale value copied from elsewhere.
      // Fall back to creating fresh rather than failing setup outright.
      console.warn(`${AGENT_ID_KEY}=${id} was not found; creating a new agent instead.`);
      return createAgent(client, config);
    }
    throw error;
  }
}

function createEnvironment(client: Anthropic, config: Anthropic.Beta.Environments.EnvironmentCreateParams) {
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
      console.log(`Environment "${current.name}" (${current.id}) already matches; skipping update.`);
      return current;
    }
    return await client.beta.environments.update(id, config);
  } catch (error) {
    if (error instanceof NotFoundError) {
      // Same reasoning as the agent side above: a stale/wrong-workspace id
      // shouldn't fail setup outright.
      console.warn(`${ENVIRONMENT_ID_KEY}=${id} was not found; creating a new environment instead.`);
      return createEnvironment(client, config);
    }
    throw error;
  }
}

function writeSetupEnv(agentId: string, agentVersion: number, environmentId: string) {
  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const withAgentId = upsertEnvVar(existing, AGENT_ID_KEY, agentId);
  const withAgentVersion = upsertEnvVar(withAgentId, AGENT_VERSION_KEY, String(agentVersion));
  const withEnvironmentId = upsertEnvVar(withAgentVersion, ENVIRONMENT_ID_KEY, environmentId);
  writeFileSync(ENV_PATH, withEnvironmentId);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
