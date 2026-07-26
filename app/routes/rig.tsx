import Anthropic from "@anthropic-ai/sdk";
import type { Prisma, Posture } from "../../generated/prisma/client";
import { db } from "~/db.server";
import { dispatchTool } from "~/rig/dispatchTool";
import { createAnthropicSessionSource } from "~/rig/anthropicSessionSource";
import { getOrCreateRigSession } from "~/rig/rigSession";
import { saveToMargin } from "~/rig/saveToMargin";
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
 * underneath it. POST sends a plain message into the same RigSession, or —
 * #29's addition — saves a Rig answer to the margin as a real Entry.
 *
 * The ask half stays deliberately thin, scoped to the mechanics rather
 * than the full Rig UI: this action takes a `message` field and an
 * optional `posture` field (#27's lens rail) — when a posture is given,
 * the held posture is named at the start of the turn via framePostureTurn,
 * per the build plan ("the held posture is named in each user message")
 * and agentConfig.ts's system prompt ("The posture is stated at the start
 * of each turn"); re-framing the same question, not a different agent
 * invocation. Without a posture, the raw message is sent as-is — this
 * keeps the field optional rather than required, since a caller that
 * doesn't yet have a lens rail still has a working POST. #28's slash
 * palette and #29's context-set UI (both in read.tsx/SelectionHighlighter)
 * are what actually decide what a turn says; this route only relays it.
 *
 * NOTE: the ask/stream half is unverified end-to-end. There is no
 * ANTHROPIC_API_KEY in this environment (and no READING_RIG_ENVIRONMENT_ID
 * provisioned either — see requireEnv below), so that part of this route
 * has only been typechecked against the installed SDK, never run against
 * the real API. The part of this ticket that *is* verified — stream-drop /
 * reconnect / dedupe — lives in app/rig/sessionLoop.test.ts against a
 * fake SessionEventSource, which is everything this route delegates that
 * behavior to. #29's saveToMargin branch below has no such ceiling: it's a
 * plain Prisma write with no Anthropic dependency, and is exercised
 * end-to-end (real database, real render) — see app/rig/saveToMargin.ts.
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
 * Same ownership boundary read.tsx's action enforces for highlight/note/
 * bookmark, factored out here since #29's saveToMargin intent needs it
 * too, alongside the ask flow's own paragraphId check below — a
 * paragraphId from another work can't be smuggled into either.
 */
async function requireOwnedParagraph(workId: string, paragraphId: string) {
  const paragraph = await db.paragraph.findFirst({
    where: { id: paragraphId, section: { chapter: { workId } } },
    select: { id: true },
  });
  if (!paragraph) throw new Response("Not found", { status: 404 });
  return paragraph;
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
  const intent = formData.get("intent");

  // #29's real save-to-margin mechanism: a Rig answer becomes an Entry
  // with origin "rig", carrying the posture it was asked under, the
  // context set that was actually in view (contextSnapshot), and the
  // paragraph it was anchored to — the same three fields the schema's own
  // comment on Entry names as what M3 adds. Branches ahead of the ask
  // flow below (which has no `intent` field of its own) so existing
  // callers — read.tsx's "Ask" box, SelectionHighlighter's slash
  // palette — keep working unchanged.
  if (intent === "saveToMargin") {
    const body = String(formData.get("body") ?? "").trim();
    if (!body) throw new Response("A saved answer needs a body.", { status: 400 });

    const postureParam = String(formData.get("posture") ?? "").trim();
    if (!(postureParam in POSTURE_LABELS)) {
      throw new Response("A Rig entry needs the posture it was asked under.", { status: 400 });
    }

    const anchorParagraphId = String(formData.get("anchorParagraphId") ?? "").trim();
    if (!anchorParagraphId) throw new Response("A Rig entry needs an anchor paragraph.", { status: 400 });
    await requireOwnedParagraph(workId, anchorParagraphId);

    // contextSnapshot travels as a JSON string (it's a nested object, not
    // a scalar form field) — the actual context set the reader saw before
    // asking, built client-side by app/domain/contextStatement.ts and
    // carried through unmodified from the moment the question was asked
    // to the moment it's saved, per the ticket's own "its contextSnapshot
    // (the actual context set that was in view)".
    const contextSnapshotRaw = formData.get("contextSnapshot");
    let contextSnapshot: Prisma.InputJsonValue = {};
    if (typeof contextSnapshotRaw === "string" && contextSnapshotRaw.trim()) {
      try {
        contextSnapshot = JSON.parse(contextSnapshotRaw) as Prisma.InputJsonValue;
      } catch {
        throw new Response("Malformed contextSnapshot.", { status: 400 });
      }
    }

    const entry = await saveToMargin(db, {
      userId: user.id,
      body,
      posture: postureParam as Posture,
      anchorParagraphId,
      contextSnapshot,
    });
    return { ok: true, entryId: entry.id };
  }

  const message = String(formData.get("message") ?? "").trim();
  if (!message) throw new Response("A message is required.", { status: 400 });

  const postureParam = formData.get("posture");
  const posture = typeof postureParam === "string" && postureParam.trim() ? postureParam.trim() : undefined;
  if (posture && !(posture in POSTURE_LABELS)) {
    throw new Response("Unknown posture.", { status: 400 });
  }
  const content = posture ? framePostureTurn(POSTURE_LABELS[posture], message) : message;

  // #28's slash palette anchors a turn to the passage it was asked from —
  // the same (paragraphId, startOffset, endOffset) tuple #8's selection
  // machinery resolves for a highlight or a note. Optional for the same
  // reason `posture` is: #27's lens rail "Ask" box has no selection to
  // anchor to and still needs a working POST. When it is present, this
  // re-validates paragraph ownership against this user's own work — the
  // same boundary read.tsx's action enforces for highlight/note/bookmark —
  // so a paragraphId from another work can't be smuggled in here even
  // though this route otherwise trusts the client for the message text
  // itself. Not yet persisted anywhere: there's no ChatMessage/turn record
  // to hang it off — that's #29 (Save to margin) above, which is why that
  // branch takes its own anchorParagraphId directly from the client
  // rather than reading anything written here.
  const paragraphIdParam = formData.get("paragraphId");
  if (typeof paragraphIdParam === "string" && paragraphIdParam.trim()) {
    await requireOwnedParagraph(workId, paragraphIdParam.trim());
  }

  // Caught, not thrown further: a fetcher.submit() to this action runs
  // from read.tsx's own "Ask" box (#27) and SelectionHighlighter's slash
  // palette (#28), and a thrown Response from an action bubbles to the
  // nearest ErrorBoundary of the route that *called* the fetcher — not a
  // boundary on this route, which isn't even part of that page's matches
  // — replacing the whole reader, not just the ask affordance. That's the
  // right behaviour for a genuine client mistake (the two throws above:
  // an empty message, an unknown posture — both programmer errors, never
  // reachable through the real UI), but not for "the environment isn't
  // configured yet", which is the ordinary, expected state of this route
  // until READING_RIG_AGENT_ID/READING_RIG_AGENT_VERSION/
  // READING_RIG_ENVIRONMENT_ID and a real ANTHROPIC_API_KEY exist (see
  // resolveRigSession and this file's own top-of-file NOTE) — a reader
  // asking a question shouldn't lose the whole page over it.
  try {
    const { client, rigSession } = await resolveRigSession(user.id, workId);
    const source = createAnthropicSessionSource(client);

    const event: SendableEvent = { type: "user.message", content: [{ type: "text", text: content }] };
    await source.send(rigSession.anthropicSessionId, [event]);

    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Response
        ? await error.text()
        : error instanceof Error
          ? error.message
          : String(error);
    return { ok: false, error: message };
  }
}
