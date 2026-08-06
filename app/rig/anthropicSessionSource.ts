import { NotFoundError } from "@anthropic-ai/sdk";
import type Anthropic from "@anthropic-ai/sdk";
import type { RigSessionEvent, SendableEvent, SessionEventSource } from "./sessionSource";

/**
 * The real network implementation of `SessionEventSource` — thin by
 * design, same discipline as scripts/setup-agent.ts and agentConfig.ts's
 * network glue. The part worth testing (stream-first ordering, the
 * custom-tool dispatch loop, reconnect-with-dedupe) lives in
 * sessionLoop.ts, tested against a fake `SessionEventSource`.
 *
 * NOTE: this file has not been run against the real API. There is no
 * ANTHROPIC_API_KEY in this environment, so it's verified only by
 * typechecking against the installed SDK's actual event/param shapes
 * (`app/rig/sessionLoop.test.ts` is what actually exercises the loop's
 * behavior). The `RigSessionEvent` shapes it hands back are a structural
 * subset of the real SDK's event union, not a translation — field names
 * (`agent.custom_tool_use`'s `id`/`name`/`input`, `session.status_idle`'s
 * `stop_reason`) match on purpose.
 */
export function createAnthropicSessionSource(client: Anthropic): SessionEventSource {
  return {
    stream(sessionId: string) {
      return streamLiveEvents(client, sessionId);
    },

    async listEvents(sessionId: string): Promise<RigSessionEvent[]> {
      const events: RigSessionEvent[] = [];
      for await (const event of client.beta.sessions.events.list(sessionId)) {
        events.push(event as unknown as RigSessionEvent);
      }
      return events;
    },

    async send(sessionId: string, events: SendableEvent[]): Promise<void> {
      await client.beta.sessions.events.send(sessionId, {
        events: events as unknown as Anthropic.Beta.Sessions.EventSendParams["events"],
      });
    },
  };
}

/**
 * Whether `error` is Anthropic reporting that a specific session id no
 * longer resolves to anything — the shape a `RigSession.anthropicSessionId`
 * hits once the session it names has expired or been deleted server-side
 * (see rigSession.ts's `withRigSessionRecovery`, the caller that acts on
 * this). Deliberately narrower than "any 404 from the SDK": a 404 for the
 * agent or environment themselves (see scripts/setup-agent.ts) is a
 * different problem and must not trigger session recreation.
 */
export function isSessionNotFoundError(error: unknown): boolean {
  if (!(error instanceof NotFoundError)) return false;
  const body = error.error as { error?: { message?: unknown } } | undefined;
  return typeof body?.error?.message === "string" && body.error.message.startsWith("Session not found");
}

async function* streamLiveEvents(client: Anthropic, sessionId: string): AsyncGenerator<RigSessionEvent> {
  // event_deltas opts this connection into event_start/event_delta preview
  // frames ahead of the buffered agent.message they reconcile into — without
  // it Anthropic only ever emits the complete, already-typed-out message,
  // which is what produced the "long delay, then several paragraphs at
  // once" behavior this was added to fix.
  const stream = await client.beta.sessions.events.stream(sessionId, {
    event_deltas: ["agent.message"],
  });
  for await (const event of stream) {
    yield event as unknown as RigSessionEvent;
  }
}
