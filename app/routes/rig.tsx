import { db } from "~/db.server";
import { dispatchTool } from "~/rig/dispatchTool";
import { createAnthropicSessionClient } from "~/rig/anthropicSessionClient";
import { createAnthropicSessionSource, isSessionNotFoundError } from "~/rig/anthropicSessionSource";
import { getOrCreateActiveRigSession, getRigSessionById, withRigSessionRecovery } from "~/rig/rigSession";
import { runRigSessionLoop } from "~/rig/sessionLoop";
import type { RigSessionEvent, SendableEvent } from "~/rig/sessionSource";
import { requireUser } from "~/user.server";
import type { Route } from "./+types/rig";

/**
 * Session-lifecycle route for the Rig — #26. GET opens a stream-first SSE
 * connection (this server's stream against Anthropic is opened, per
 * sessionLoop.ts, before anything else is trusted) and relays every event
 * the session emits, including running the custom-tool dispatch loop
 * underneath it. POST sends a plain message into the same RigSession.
 *
 * Both take an optional `?session=<id>` — the session picker's way of
 * naming *which* RigSession for this (user, work) to operate on. Omitted,
 * this falls back to `getOrCreateActiveRigSession` (the most recently
 * created one, or a fresh one on a work's very first open) — the same
 * behavior this route had before there could be more than one session per
 * (user, work). See rig-sessions.tsx for listing/creating the sessions the
 * picker offers.
 *
 * Deliberately thin and scoped to the mechanics, not the full Rig UI: the
 * lens rail (#18), slash palette (#19), and context-set framing (#20) that
 * decide *what* a turn actually says are later tickets. This action takes
 * a raw `message` field and sends it as-is.
 *
 * Both loader and action route their Anthropic call through
 * `withRigSessionRecovery` (see rigSession.ts) rather than calling `source`
 * directly against `rigSession.anthropicSessionId` — a RigSession row is
 * meant to be resumable indefinitely, but the Anthropic session it names
 * isn't guaranteed to outlive it (see #113). Without this, a session
 * Anthropic has since expired or deleted 404s on every subsequent request
 * that names it, forever.
 *
 * NOTE: unverified end-to-end. There is no ANTHROPIC_API_KEY in this
 * environment, so this route has only been typechecked against the
 * installed SDK, never run against the real API. The part of this ticket
 * that *is* verified — stream-drop / reconnect / dedupe — lives in
 * app/rig/sessionLoop.test.ts against a fake SessionEventSource, which is
 * everything this route delegates that behavior to.
 */

async function requireOwnedWork(userId: string, workId: string) {
  return db.work.findFirstOrThrow({ where: { id: workId, ownerId: userId } });
}

/**
 * Resolves to a specific RigSession by id when the caller named one (404 if
 * it doesn't exist or belongs to someone/something else — same response
 * either way, see getRigSessionById), otherwise falls back to whichever
 * session `getOrCreateActiveRigSession` considers active. Called from both
 * the loader and the action rather than threaded between them, since the
 * two are separate HTTP requests in this framework and either lookup is
 * cheap.
 */
async function resolveRigSession(userId: string, workId: string, sessionId: string | null) {
  const { client, agentVersion, createAnthropicSession } = createAnthropicSessionClient();

  const rigSession = sessionId
    ? await requireRigSession(userId, workId, sessionId)
    : await getOrCreateActiveRigSession(db, { userId, workId, agentVersion }, createAnthropicSession);

  return { client, rigSession, createAnthropicSession };
}

async function requireRigSession(userId: string, workId: string, sessionId: string) {
  const rigSession = await getRigSessionById(db, { userId, workId, sessionId });
  if (!rigSession) throw new Response("Rig session not found", { status: 404 });
  return rigSession;
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const user = await requireUser();
  const workId = params["*"];
  await requireOwnedWork(user.id, workId);
  const sessionId = new URL(request.url).searchParams.get("session");

  const { client, rigSession, createAnthropicSession } = await resolveRigSession(user.id, workId, sessionId);
  const source = createAnthropicSessionSource(client);

  const encoder = new TextEncoder();
  let cancelled = false;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const onEvent = (event: RigSessionEvent) => {
        if (cancelled) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // withRigSessionRecovery: if the stored RigSession names an Anthropic
      // session that's since expired or been deleted, this replaces it and
      // retries once instead of surfacing a permanent 404 to every future
      // request for this (user, work) — see rigSession.ts.
      withRigSessionRecovery(db, rigSession, createAnthropicSession, isSessionNotFoundError, (session) =>
        runRigSessionLoop({
          source,
          sessionId: session.anthropicSessionId,
          dispatch: (toolName, input) => dispatchTool(toolName, input, { db, userId: user.id, workId }),
          onEvent,
        }),
      )
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
  const sessionId = new URL(request.url).searchParams.get("session");

  const { client, rigSession, createAnthropicSession } = await resolveRigSession(user.id, workId, sessionId);
  const source = createAnthropicSessionSource(client);

  const event: SendableEvent = { type: "user.message", content: [{ type: "text", text: message }] };
  await withRigSessionRecovery(db, rigSession, createAnthropicSession, isSessionNotFoundError, (session) =>
    source.send(session.anthropicSessionId, [event]),
  );

  return { ok: true };
}
