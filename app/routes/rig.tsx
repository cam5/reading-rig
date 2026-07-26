import Anthropic from "@anthropic-ai/sdk";
import { db } from "~/db.server";
import { dispatchTool } from "~/rig/dispatchTool";
import { createAnthropicSessionSource } from "~/rig/anthropicSessionSource";
import { getOrCreateRigSession } from "~/rig/rigSession";
import { runRigSessionLoop } from "~/rig/sessionLoop";
import type { RigSessionEvent, SendableEvent } from "~/rig/sessionSource";
import { requireUser } from "~/user.server";
import { framePostureTurn, POSTURE_LABELS } from "~/domain/postures";
import type { Route } from "./+types/rig";

/**
 * Session-lifecycle route for the Rig — #26. GET opens a stream-first SSE
 * connection (this server's stream against Anthropic is opened, per
 * sessionLoop.ts, before anything else is trusted) and relays every event
 * the session emits, including running the custom-tool dispatch loop
 * underneath it. POST sends a plain message into the same RigSession.
 *
 * Deliberately thin and scoped to the mechanics, not the full Rig UI: the
 * slash palette (#28) and context-set framing (#29) that decide *what*
 * else a turn says are later tickets. This action takes a `message` field
 * and an optional `posture` field (#27's lens rail) — when a posture is
 * given, the held posture is named at the start of the turn via
 * framePostureTurn, per the build plan ("the held posture is named in
 * each user message") and agentConfig.ts's system prompt ("The posture is
 * stated at the start of each turn"); re-framing the same question, not a
 * different agent invocation. Without a posture, the raw message is sent
 * as-is — this keeps the field optional rather than required, since a
 * caller that doesn't yet have a lens rail (or a future one that lets a
 * turn go unposture'd) still has a working POST.
 *
 * NOTE: unverified end-to-end. There is no ANTHROPIC_API_KEY in this
 * environment (and no READING_RIG_ENVIRONMENT_ID provisioned either — see
 * requireEnv below), so this route has only been typechecked against the
 * installed SDK, never run against the real API. The part of this ticket
 * that *is* verified — stream-drop / reconnect / dedupe — lives in
 * app/rig/sessionLoop.test.ts against a fake SessionEventSource, which is
 * everything this route delegates that behavior to.
 */

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Response(`${key} is not set — see .env.example.`, { status: 500 });
  }
  return value;
}

async function requireOwnedWork(userId: string, workId: string) {
  return db.work.findFirstOrThrow({ where: { id: workId, ownerId: userId } });
}

/**
 * Everything needed to talk to this (user, work)'s Anthropic session:
 * looks up or creates the RigSession row (see rigSession.ts — "resumed on
 * return") and returns a client plus the resolved session id. Called from
 * both the loader and the action rather than threaded between them, since
 * the two are separate HTTP requests in this framework and a RigSession
 * lookup is a cheap upsert-shaped read once the row already exists.
 */
async function resolveRigSession(userId: string, workId: string) {
  const agentId = requireEnv("READING_RIG_AGENT_ID");
  const agentVersion = requireEnv("READING_RIG_AGENT_VERSION");
  // Every Managed Agents session provisions a container as its workspace,
  // even one like the Rig's that only calls custom tools plus web
  // search/fetch — `environment_id` is a required field of
  // `sessions.create` regardless. Provisioning one is outside this
  // ticket's scope (RigSession/stream/dispatch/reconnect); this reads it
  // from .env the same way the agent id/version already are, and fails
  // loudly rather than guessing if it isn't set yet.
  const environmentId = requireEnv("READING_RIG_ENVIRONMENT_ID");

  const client = new Anthropic();
  const rigSession = await getOrCreateRigSession(db, { userId, workId, agentVersion }, async () => {
    const session = await client.beta.sessions.create({
      agent: { type: "agent", id: agentId, version: Number(agentVersion) },
      environment_id: environmentId,
    });
    return { anthropicSessionId: session.id };
  });

  return { client, rigSession };
}

export async function loader({ params }: Route.LoaderArgs) {
  const user = await requireUser();
  const workId = params["*"];
  await requireOwnedWork(user.id, workId);

  const { client, rigSession } = await resolveRigSession(user.id, workId);
  const source = createAnthropicSessionSource(client);

  const encoder = new TextEncoder();
  let cancelled = false;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const onEvent = (event: RigSessionEvent) => {
        if (cancelled) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      runRigSessionLoop({
        source,
        sessionId: rigSession.anthropicSessionId,
        dispatch: (toolName, input) => dispatchTool(toolName, input, { db, userId: user.id, workId }),
        onEvent,
      })
        .catch((error: unknown) => {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`));
        })
        .finally(() => {
          if (!cancelled) controller.close();
        });
    },
    cancel() {
      // The browser closed the EventSource (navigated away, reloaded).
      // sessionLoop.ts has no cancellation signal of its own yet — this
      // just stops the *response* from writing to a closed controller.
      // A live session left mid-loop is exactly what the reconnect path
      // is for the next time this route's loader runs for this work.
      cancelled = true;
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function action({ params, request }: Route.ActionArgs) {
  const user = await requireUser();
  const workId = params["*"];
  await requireOwnedWork(user.id, workId);

  const formData = await request.formData();
  const message = String(formData.get("message") ?? "").trim();
  if (!message) throw new Response("A message is required.", { status: 400 });

  const postureParam = formData.get("posture");
  const posture = typeof postureParam === "string" && postureParam.trim() ? postureParam.trim() : undefined;
  if (posture && !(posture in POSTURE_LABELS)) {
    throw new Response("Unknown posture.", { status: 400 });
  }
  const content = posture ? framePostureTurn(POSTURE_LABELS[posture], message) : message;

  const { client, rigSession } = await resolveRigSession(user.id, workId);
  const source = createAnthropicSessionSource(client);

  const event: SendableEvent = { type: "user.message", content: [{ type: "text", text: content }] };
  await source.send(rigSession.anthropicSessionId, [event]);

  return { ok: true };
}
