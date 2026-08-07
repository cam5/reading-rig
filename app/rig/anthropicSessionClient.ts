import Anthropic from "@anthropic-ai/sdk";
import type { CreateAnthropicSession } from "./rigSession";

export type AnthropicSessionClient = {
  client: Anthropic;
  agentVersion: string;
  createAnthropicSession: CreateAnthropicSession;
};

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Response(`${key} is not set — see .env.example.`, { status: 500 });
  }
  return value;
}

/**
 * Everything both rig.tsx (stream/send against a specific session) and
 * rig-sessions.tsx (list/create sessions) need to talk to Anthropic —
 * factored out once it was needed from two route files instead of one.
 * `createAnthropicSession` is a closure over the same `client` it hands
 * back, so a caller can mint as many sessions through it as it needs
 * (rig.tsx's `withRigSessionRecovery` replacing a stale one, or
 * rig-sessions.tsx's action starting a fresh one outright) without
 * reconstructing the client each time.
 */
export function createAnthropicSessionClient(): AnthropicSessionClient {
  const agentId = requireEnv("READING_RIG_AGENT_ID");
  const agentVersion = requireEnv("READING_RIG_AGENT_VERSION");
  // Every Managed Agents session provisions a container as its workspace,
  // even one like the Rig's that only calls custom tools plus web
  // search/fetch — `environment_id` is a required field of
  // `sessions.create` regardless. `scripts/setup-agent.ts` provisions and
  // converges it the same way it does the agent; this just reads the id
  // it wrote to .env, and fails loudly rather than guessing if it isn't
  // set yet.
  const environmentId = requireEnv("READING_RIG_ENVIRONMENT_ID");

  const client = new Anthropic();
  const createAnthropicSession: CreateAnthropicSession = async () => {
    const session = await client.beta.sessions.create({
      agent: { type: "agent", id: agentId, version: Number(agentVersion) },
      environment_id: environmentId,
    });
    return { anthropicSessionId: session.id };
  };

  return { client, agentVersion, createAnthropicSession };
}
