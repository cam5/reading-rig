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
 * caused the original stale-session incident. `npm run agent:setup` (or
 * `scripts/release.ts` on deploy) is normally what creates that row, but a
 * missing row is no longer treated as fatal here — staging-qa's DB gets
 * reset on every deploy (see release.ts's isEphemeralRailwayDeploy), and a
 * request can land before that reset's own re-provisioning step has
 * durably landed. Provisioning on demand the first time a request beats
 * the setup step to it is the same converge-or-create work
 * `ensureRigProvisioning` already does at deploy time, so doing it here too
 * costs nothing extra when the row already exists.
 *
 * If `sessions.create` itself reports the agent or environment no longer
 * resolves (`NotFoundError` — distinct from a *session* going stale, which
 * `withRigSessionRecovery` in rigSession.ts already handles one layer up),
 * this re-provisions via `ensureRigProvisioning` and retries once — the Rig
 * self-heals on the very next real request instead of needing a redeploy.
 */
export async function createAnthropicSessionClient(db: PrismaClient): Promise<AnthropicSessionClient> {
  const client = new Anthropic();

  const provisioning = (await getRigProvisioning(db)) ?? (await ensureRigProvisioning(client, db));

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
