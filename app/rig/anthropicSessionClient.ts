import Anthropic, { NotFoundError } from "@anthropic-ai/sdk";
import type { PrismaClient } from "../../generated/prisma/client";
import { ensureRigProvisioning, getRigProvisioning, type RigProvisioning } from "./rigProvisioning";
import type { CreateAnthropicSession } from "./rigSession";

export type AnthropicSessionClient = {
  client: Anthropic;
  agentVersion: string;
  createAnthropicSession: CreateAnthropicSession;
};

/**
 * Everything both rig.tsx (stream/send against a specific session) and
 * rig-sessions.tsx (list/create sessions) need to talk to Anthropic: a
 * client, the agent version currently in effect (recorded onto each
 * RigSession as provenance — see RigSession.agentVersion's doc comment),
 * and a `createAnthropicSession` closure that mints a session against the
 * Rig's current agent + environment.
 *
 * Provisioning ids come from the RigProvisioning DB row (rigProvisioning.ts),
 * not process.env — .env/Railway Variables drift between the two is what
 * caused the original stale-session incident. Throws a 500 if that row
 * doesn't exist yet — `npm run agent:setup` (or `scripts/release.ts` on
 * deploy) is what creates it; a request should never be the first thing to
 * provision the Rig.
 *
 * If `sessions.create` itself reports the agent or environment no longer
 * resolves (`NotFoundError` — distinct from a *session* going stale, which
 * `withRigSessionRecovery` in rigSession.ts already handles one layer up),
 * this re-provisions via `ensureRigProvisioning` and retries once — the Rig
 * self-heals on the very next real request instead of needing a redeploy.
 */
export async function createAnthropicSessionClient(db: PrismaClient): Promise<AnthropicSessionClient> {
  const client = new Anthropic();

  const provisioning = await getRigProvisioning(db);
  if (!provisioning) {
    throw new Response("The Rig hasn't been provisioned yet — run `npm run agent:setup`.", { status: 500 });
  }

  const createAnthropicSession: CreateAnthropicSession = async () => {
    try {
      return await createSession(client, provisioning);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      const refreshed = await ensureRigProvisioning(client, db);
      return createSession(client, refreshed);
    }
  };

  return { client, agentVersion: String(provisioning.agentVersion), createAnthropicSession };
}

async function createSession(
  client: Anthropic,
  provisioning: RigProvisioning,
): Promise<{ anthropicSessionId: string }> {
  const session = await client.beta.sessions.create({
    agent: { type: "agent", id: provisioning.agentId, version: provisioning.agentVersion },
    environment_id: provisioning.environmentId,
  });
  return { anthropicSessionId: session.id };
}
