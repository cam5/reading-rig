/**
 * This is reading-rig's UI-side implementation of a Managed Agents
 * `Session` — replaying history, dispatching custom tools, and
 * reconnecting a dropped stream — not an agent loop. Anthropic's Managed
 * Agents API owns the actual agent loop; that's the point of building on
 * it instead of MCP.
 */

import {
  isCustomToolUseEvent,
  isStatusIdleEvent,
  isStatusTerminatedEvent,
  type CustomToolResultEvent,
  type RigSessionEvent,
  type SessionEventSource,
} from "./sessionSource";

export type DispatchFn = (
  toolName: string,
  input: Record<string, unknown>,
) => Promise<{ isError: boolean; text: string }>;

export type RunRigSessionLoopParams = {
  source: SessionEventSource;
  sessionId: string;
  dispatch: DispatchFn;
  /** Called once per never-before-seen event id — the SSE route's hook to
   * relay live progress out to the browser. Optional so tests that only
   * care about dispatch/dedupe/termination don't need to supply one. */
  onEvent?: (event: RigSessionEvent) => void;
};

/**
 * Drives one Anthropic Managed Agents session: stream-first ordering (the
 * stream for a connection is opened before anything else is trusted), the
 * `agent.custom_tool_use` -> dispatch -> `user.custom_tool_result` loop,
 * and reconnect-with-dedupe if the stream drops mid-flight. Resolves once
 * the session reaches a point the caller can act on — idle with a terminal
 * `stop_reason` (`end_turn` / `retries_exhausted`), the stream ending on
 * its own, or `session.status_terminated`.
 *
 * The one invariant this exists to guarantee, per the build plan: "a
 * dropped stream with a pending custom_tool_use otherwise deadlocks the
 * session." A tool result already computed but not yet sent when the
 * stream drops sits in `pendingResults` — scoped outside the per-connection
 * try/catch below, so a dropped connection doesn't take it down too — and
 * gets flushed the moment a new connection's history backfill completes.
 * `seenEventIds` is scoped the same way, so an event that reappears from
 * `listEvents` after a reconnect (the same tool call the previous
 * connection already saw) is recognized and not redispatched.
 */
export async function runRigSessionLoop(params: RunRigSessionLoopParams): Promise<void> {
  const { source, sessionId, dispatch, onEvent } = params;
  const seenEventIds = new Set<string>();
  const pendingResults: CustomToolResultEvent[] = [];

  async function flushPending(): Promise<void> {
    if (pendingResults.length === 0) return;
    const batch = pendingResults.splice(0, pendingResults.length);
    await source.send(sessionId, batch);
  }

  /**
   * Processes one event exactly once, no matter how many times it's
   * handed to us across reconnects (a live tail and a post-reconnect
   * history fetch can both hand us the same id). `onEvent` and the
   * custom-tool dispatch only fire the first time an id is seen.
   *
   * Terminal/idle checks run unconditionally, even on a repeat — a
   * terminal event replayed from history after already being seen live
   * must still end the loop, or the dedupe would strand the caller
   * waiting on a promise that never resolves.
   */
  async function handleEvent(event: RigSessionEvent): Promise<"terminated" | "idle-terminal" | "continue"> {
    if (!seenEventIds.has(event.id)) {
      seenEventIds.add(event.id);
      onEvent?.(event);

      if (isCustomToolUseEvent(event)) {
        const outcome = await dispatch(event.name, event.input);
        pendingResults.push({
          type: "user.custom_tool_result",
          custom_tool_use_id: event.id,
          content: [{ type: "text", text: outcome.text }],
          is_error: outcome.isError,
        });
      }
    }

    if (isStatusTerminatedEvent(event)) return "terminated";
    if (isStatusIdleEvent(event)) {
      return event.stop_reason.type === "requires_action" ? "continue" : "idle-terminal";
    }
    return "continue";
  }

  for (;;) {
    // Stream-first: open this connection's stream before consuming
    // anything else through it.
    const stream = source.stream(sessionId);

    // Reconnect consolidation (also just "connect", the first time
    // through): backfill from full history, deduped against what's
    // already been seen. This is what lets a `RigSession` be *resumed* —
    // reopening the Rig for a book already has a transcript — and it's
    // also the second half of surviving a drop: if the drop happened
    // before we ever sent a computed tool result, that event comes back
    // from history, gets recognized as already-seen, and is skipped —
    // it's the flush right below, not a redispatch, that unblocks the
    // session.
    //
    // A resumed session's history can span several already-finished turns,
    // each ending in its own idle/terminated boundary — those are
    // mid-history landmarks, not a reason to stop scanning. Replay the
    // *whole* array (every event still deduped/dispatched exactly once via
    // handleEvent's seenEventIds guard) and act only on where history
    // actually ends: an early return here on the first idle-terminal found
    // — rather than the last — silently dropped every turn after the
    // first on any session with more than one, which is exactly the
    // ordinary shape of a book someone has come back to more than once.
    let backfillOutcome: "terminated" | "idle-terminal" | "continue" = "continue";
    for (const event of await source.listEvents(sessionId)) {
      backfillOutcome = await handleEvent(event);
    }
    await flushPending();
    if (backfillOutcome === "terminated" || backfillOutcome === "idle-terminal") {
      return;
    }

    try {
      for await (const event of stream) {
        const outcome = await handleEvent(event);
        if (outcome === "terminated" || outcome === "idle-terminal") {
          await flushPending();
          return;
        }
        if (isStatusIdleEvent(event)) {
          // requires_action: send whatever's ready and keep reading this
          // same connection — no reason to reconnect just to unblock it.
          await flushPending();
        }
      }
      // The stream ended on its own without a terminal/idle-terminal
      // event. Nothing left to read on this connection, and nothing
      // dropped either, so there's nothing to reconnect for.
      return;
    } catch {
      // The stream dropped mid-flight — network blip, a closed
      // connection, anything. Loop back around: a fresh `source.stream()`
      // call opens the next connection, and the history-backfill step
      // above flushes anything left over from this one.
    }
    // Only a dropped stream (the catch above) falls through to here.
  }
}
