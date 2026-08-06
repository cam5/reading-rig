import "dotenv/config";
import Anthropic, { NotFoundError } from "@anthropic-ai/sdk";
import { getRigProvisioning } from "../app/rig/rigProvisioning";
import { createStandaloneDb } from "./lib/db";

// One-off, run by hand exactly once (against prod, via `railway run`) as
// part of shipping the RigProvisioning DB table: without this, the first
// deploy after that change finds no RigProvisioning row, re-provisions a
// fresh agent+environment (same "not found -> create fresh" fallback
// scripts/setup-agent.ts already had), and every RigSession pointing at
// the *currently* live agent/environment falls through to
// withRigSessionRecovery on next use — losing that book's conversation
// history for no reason, if the currently-stored ids actually still work.
//
// This seeds the RigProvisioning row from whatever READING_RIG_AGENT_ID /
// READING_RIG_AGENT_VERSION / READING_RIG_ENVIRONMENT_ID are *currently*
// set to (Railway's env, or a local .env), but only after confirming both
// still resolve live — if either doesn't, it reports that and changes
// nothing, leaving the normal ensureRigProvisioning path (setup-agent.ts
// on next deploy, or the request-time self-heal) to create fresh, exactly
// as if this script had never run.
//
// Safe to run more than once: does nothing if a RigProvisioning row
// already exists, rather than overwriting it.

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set.");
    process.exitCode = 1;
    return;
  }

  const agentId = process.env.READING_RIG_AGENT_ID;
  const agentVersion = process.env.READING_RIG_AGENT_VERSION;
  const environmentId = process.env.READING_RIG_ENVIRONMENT_ID;
  if (!agentId || !agentVersion || !environmentId) {
    console.log("READING_RIG_AGENT_ID/AGENT_VERSION/ENVIRONMENT_ID aren't all set — nothing to backfill from.");
    return;
  }

  const client = new Anthropic();
  const db = createStandaloneDb();

  try {
    const existing = await getRigProvisioning(db);
    if (existing) {
      console.log(
        `RigProvisioning already has a row (agentId=${existing.agentId}, environmentId=${existing.environmentId}); not overwriting.`,
      );
      return;
    }

    const agent = await retrieveIfLive(() => client.beta.agents.retrieve(agentId), "agent", agentId);
    const environment = await retrieveIfLive(
      () => client.beta.environments.retrieve(environmentId),
      "environment",
      environmentId,
    );
    if (!agent || !environment) return;

    await db.rigProvisioning.create({
      data: { id: "rig", agentId: agent.id, agentVersion: agent.version, environmentId: environment.id },
    });
    console.log(`Backfilled RigProvisioning from env: agentId=${agent.id}, environmentId=${environment.id}.`);
  } finally {
    await db.$disconnect();
  }
}

async function retrieveIfLive<T>(retrieve: () => Promise<T>, kind: "agent" | "environment", id: string) {
  try {
    return await retrieve();
  } catch (error) {
    if (error instanceof NotFoundError) {
      console.log(`Current ${kind} id ${id} no longer resolves — nothing to backfill; leaving this to ensureRigProvisioning.`);
      return null;
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
