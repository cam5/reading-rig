import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic, { NotFoundError } from "@anthropic-ai/sdk";
import { buildAgentConfig } from "../app/rig/agentConfig";
import { agentMatchesConfig } from "../app/rig/agentConvergence";
import { upsertEnvVar } from "../app/rig/envFile";

// Creates the Managed Agent once and stores its id/version in .env. Never
// called in the request path — see the build plan's "One agent, created
// once" invariant. Re-running this script converges the existing agent onto
// buildAgentConfig()'s current output (`POST /v1/agents/{id}`, a new
// version) instead of creating a duplicate, skipping the call entirely if
// the live agent already matches. `scripts/release.ts` also runs this on
// every deploy (when ANTHROPIC_API_KEY is set for that environment), so a
// merged config change converges automatically without a manual re-run.
//
// NOTE: this network path has not been run against the real API. There is
// no ANTHROPIC_API_KEY in this environment yet, so `agents.create` /
// `agents.update`/`retrieve` are unverified beyond typechecking against the
// installed SDK's types. `buildAgentConfig()` and `agentMatchesConfig()` —
// the parts that actually encode the scope of this ticket — have real
// Vitest coverage in app/rig/agentConfig.test.ts and
// app/rig/agentConvergence.test.ts.

const ENV_PATH = path.resolve(process.cwd(), ".env");
const AGENT_ID_KEY = "READING_RIG_AGENT_ID";
const AGENT_VERSION_KEY = "READING_RIG_AGENT_VERSION";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example), then re-run `npm run agent:setup`.",
    );
    process.exitCode = 1;
    return;
  }

  const client = new Anthropic();
  const config = buildAgentConfig();
  const existingId = process.env[AGENT_ID_KEY];

  const agent = existingId ? await updateExisting(client, existingId, config) : await create(client, config);

  writeAgentEnv(agent.id, agent.version);
  console.log(`Agent "${agent.name}" ready: ${agent.id} (version ${agent.version})`);
}

function create(client: Anthropic, config: Anthropic.Beta.Agents.AgentCreateParams) {
  return client.beta.agents.create(config);
}

async function updateExisting(client: Anthropic, id: string, config: Anthropic.Beta.Agents.AgentCreateParams) {
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
      return create(client, config);
    }
    throw error;
  }
}

function writeAgentEnv(id: string, version: number) {
  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const withId = upsertEnvVar(existing, AGENT_ID_KEY, id);
  const withVersion = upsertEnvVar(withId, AGENT_VERSION_KEY, String(version));
  writeFileSync(ENV_PATH, withVersion);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
