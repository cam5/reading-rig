import { describe, expect, it, vi } from "vitest";
import { runRigSessionLoop } from "./sessionLoop";
import type { RigSessionEvent, SendableEvent, SessionEventSource } from "./sessionSource";

/** A minimal in-memory fake of the events surface, scripted per test: a
 * queue of "connections", each either a normal async-generator stream or
 * one that throws partway through (simulating a dropped SSE connection),
 * plus a queue of `listEvents` responses for the history-backfill each
 * connection attempt makes. Records every `send` call so tests can assert
 * on exactly what got sent, and how many times. */
function createFakeSource(options: {
  connections: Array<{ events: RigSessionEvent[]; dropAfter?: boolean }>;
  historyResponses: RigSessionEvent[][];
}): SessionEventSource & { sendCalls: SendableEvent[][]; streamCallCount: number; listEventsCallCount: number } {
  let connectionIndex = 0;
  let historyIndex = 0;
  const sendCalls: SendableEvent[][] = [];
  let streamCallCount = 0;
  let listEventsCallCount = 0;

  return {
    sendCalls,
    get streamCallCount() {
      return streamCallCount;
    },
    get listEventsCallCount() {
      return listEventsCallCount;
    },
    stream(_sessionId: string) {
      streamCallCount++;
      const connection = options.connections[connectionIndex];
      connectionIndex++;
      if (!connection) throw new Error("test fake ran out of scripted connections");

      return (async function* () {
        for (const event of connection.events) {
          yield event;
        }
        if (connection.dropAfter) {
          throw new Error("simulated stream drop");
        }
      })();
    },
    async listEvents(_sessionId: string) {
      listEventsCallCount++;
      const response = options.historyResponses[historyIndex] ?? [];
      historyIndex++;
      return response;
    },
    async send(_sessionId: string, events: SendableEvent[]) {
      sendCalls.push(events);
    },
  };
}

describe("runRigSessionLoop", () => {
  // The literal "done when" criterion: a session survives a simulated
  // stream drop mid-tool-call without deadlocking.
  it("survives a stream drop that happens right after a custom_tool_use, without redispatching or hanging", async () => {
    const toolUseEvent: RigSessionEvent = {
      type: "agent.custom_tool_use",
      id: "sevt_1",
      name: "get_passage",
      input: { paragraphId: "p1" },
    };

    const source = createFakeSource({
      connections: [
        // Connection 1: the tool call arrives, then the stream drops
        // before any session.status_idle would have told the loop it was
        // safe to flush the computed result.
        { events: [toolUseEvent], dropAfter: true },
        // Connection 2 (the reconnect): nothing new arrives live, and the
        // stream just ends cleanly — enough to prove the loop completes
        // rather than hanging.
        { events: [], dropAfter: false },
      ],
      historyResponses: [
        // Backfill on connection 1's connect (before the live tail):
        // nothing has happened yet.
        [],
        // Backfill on the reconnect: the server's own history now
        // includes the same custom_tool_use event the dropped connection
        // saw live — this is the replay the loop must dedupe.
        [toolUseEvent],
      ],
    });

    const dispatch = vi.fn().mockResolvedValue({ isError: false, text: '{"text":"passage"}' });
    const onEvent = vi.fn();

    // If this hangs, the test times out and fails — that alone is part of
    // the "doesn't deadlock" proof. The assertions below additionally
    // confirm *why* it doesn't hang.
    await runRigSessionLoop({ source, sessionId: "sesn_1", dispatch, onEvent });

    // Dispatched exactly once — the replayed history event was recognized
    // as already-seen, not redispatched.
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith("get_passage", { paragraphId: "p1" });

    // onEvent likewise fires once per event id, not once per delivery.
    expect(onEvent).toHaveBeenCalledTimes(1);

    // The tool result computed before the drop was never lost — it went
    // out exactly once, in the flush right after the reconnect's history
    // backfill.
    expect(source.sendCalls).toHaveLength(1);
    expect(source.sendCalls[0]).toEqual([
      {
        type: "user.custom_tool_result",
        custom_tool_use_id: "sevt_1",
        content: [{ type: "text", text: '{"text":"passage"}' }],
        is_error: false,
      },
    ]);

    // Stream-first: a fresh stream was opened for both the original
    // connection and the reconnect, and each connection did its history
    // backfill.
    expect(source.streamCallCount).toBe(2);
    expect(source.listEventsCallCount).toBe(2);
  });

  it("converts a dispatch that throws into an error tool result instead of hanging or reconnecting forever", async () => {
    // dispatchTool.ts is supposed to never throw, but the loop can't rely
    // on that being true of every dispatch function forever — before this
    // was guarded, a throw here fell into the stream-level catch below,
    // got misread as a transport drop, and reconnected into a session
    // stuck waiting on a tool result that would never come (the dedupe
    // skips a replayed already-seen event, so nothing ever retried it).
    const toolUseEvent: RigSessionEvent = {
      type: "agent.custom_tool_use",
      id: "sevt_1",
      name: "get_passage",
      input: { paragraphId: "p1" },
    };
    const idleEndTurn: RigSessionEvent = {
      type: "session.status_idle",
      id: "sevt_2",
      stop_reason: { type: "end_turn" },
    };

    const source = createFakeSource({
      connections: [{ events: [toolUseEvent, idleEndTurn], dropAfter: false }],
      historyResponses: [[]],
    });

    const dispatch = vi.fn().mockRejectedValue(new Error("db down"));

    // If this hangs or loops, the test times out — the assertions below
    // additionally confirm it resolves for the right reason.
    await runRigSessionLoop({ source, sessionId: "sesn_1", dispatch });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(source.sendCalls).toHaveLength(1);
    expect(source.sendCalls[0]).toEqual([
      {
        type: "user.custom_tool_result",
        custom_tool_use_id: "sevt_1",
        content: [{ type: "text", text: "Tool call failed: db down" }],
        is_error: true,
      },
    ]);
    // Reached idle-terminal on the one connection — never reconnected
    // looking for a retry that was never coming.
    expect(source.streamCallCount).toBe(1);
  });

  it("dedupes an event seen live and then replayed again from the same connection's own history on a later reconnect", async () => {
    // A second drop, later in the same session, replays the *same*
    // already-flushed event again via history — the loop must still not
    // re-send or re-dispatch it.
    const toolUseEvent: RigSessionEvent = {
      type: "agent.custom_tool_use",
      id: "sevt_1",
      name: "list_threads",
      input: {},
    };
    const idleRequiresAction: RigSessionEvent = {
      type: "session.status_idle",
      id: "sevt_2",
      stop_reason: { type: "requires_action", event_ids: ["sevt_1"] },
    };
    const idleEndTurn: RigSessionEvent = {
      type: "session.status_idle",
      id: "sevt_3",
      stop_reason: { type: "end_turn" },
    };

    const source = createFakeSource({
      connections: [
        // Tool call arrives and immediately goes idle/requires_action on
        // the *same* connection — flushed without ever reconnecting.
        { events: [toolUseEvent, idleRequiresAction], dropAfter: true },
        // Reconnect: history now shows all three prior events (the tool
        // call and the first idle), plus a new terminal idle live.
        { events: [idleEndTurn], dropAfter: false },
      ],
      historyResponses: [[], [toolUseEvent, idleRequiresAction]],
    });

    const dispatch = vi.fn().mockResolvedValue({ isError: false, text: "[]" });

    await runRigSessionLoop({ source, sessionId: "sesn_1", dispatch });

    expect(dispatch).toHaveBeenCalledTimes(1);
    // Sent once, from the requires_action flush on connection 1 — the
    // reconnect's history replay of the same ids produces no second send.
    expect(source.sendCalls).toHaveLength(1);
  });

  it("stops cleanly on session.status_terminated without trying to reconnect", async () => {
    const terminated: RigSessionEvent = { type: "session.status_terminated", id: "sevt_9" };
    const source = createFakeSource({
      connections: [{ events: [terminated], dropAfter: false }],
      historyResponses: [[]],
    });
    const dispatch = vi.fn();

    await runRigSessionLoop({ source, sessionId: "sesn_1", dispatch });

    expect(source.streamCallCount).toBe(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("returns once idle with a terminal stop_reason (end_turn), not on every idle", async () => {
    const idleRequiresAction: RigSessionEvent = {
      type: "session.status_idle",
      id: "sevt_1",
      stop_reason: { type: "requires_action" },
    };
    const idleEndTurn: RigSessionEvent = {
      type: "session.status_idle",
      id: "sevt_2",
      stop_reason: { type: "end_turn" },
    };
    const source = createFakeSource({
      connections: [{ events: [idleRequiresAction, idleEndTurn], dropAfter: false }],
      historyResponses: [[]],
    });

    await runRigSessionLoop({ source, sessionId: "sesn_1", dispatch: vi.fn() });

    // Only one connection was needed — requires_action kept reading the
    // same stream instead of reconnecting.
    expect(source.streamCallCount).toBe(1);
  });

  it("replays a resumed session's full history, not just the first of several already-finished turns", async () => {
    // Two complete turns already sit in history before this connection
    // ever opens — the ordinary shape of reopening the Rig for a book
    // that's been asked about more than once. Nothing arrives live; the
    // whole point is what the backfill alone surfaces.
    const turn1Message: RigSessionEvent = { type: "user.message", id: "sevt_1", content: [{ type: "text", text: "first" }] };
    const turn1Idle: RigSessionEvent = { type: "session.status_idle", id: "sevt_2", stop_reason: { type: "end_turn" } };
    const turn2Message: RigSessionEvent = { type: "user.message", id: "sevt_3", content: [{ type: "text", text: "second" }] };
    const turn2Idle: RigSessionEvent = { type: "session.status_idle", id: "sevt_4", stop_reason: { type: "end_turn" } };

    const source = createFakeSource({
      connections: [{ events: [], dropAfter: false }],
      historyResponses: [[turn1Message, turn1Idle, turn2Message, turn2Idle]],
    });
    const onEvent = vi.fn();

    await runRigSessionLoop({ source, sessionId: "sesn_1", dispatch: vi.fn(), onEvent });

    // All four events surfaced — turn 1's idle boundary, in the middle of
    // history, didn't cut the replay short before turn 2.
    expect(onEvent).toHaveBeenCalledTimes(4);
    expect(onEvent).toHaveBeenCalledWith(turn2Message);
    expect(onEvent).toHaveBeenCalledWith(turn2Idle);
    // Only one connection was needed — the backfill alone already ended on
    // an idle-terminal event, so there was nothing live left to wait for.
    expect(source.streamCallCount).toBe(1);
  });

  it("passes every never-before-seen event to onEvent, including plain passthrough events", async () => {
    const message: RigSessionEvent = { type: "agent.message", id: "sevt_1", content: [{ type: "text", text: "hi" }] };
    const idleEndTurn: RigSessionEvent = { type: "session.status_idle", id: "sevt_2", stop_reason: { type: "end_turn" } };
    const source = createFakeSource({
      connections: [{ events: [message, idleEndTurn], dropAfter: false }],
      historyResponses: [[]],
    });
    const onEvent = vi.fn();

    await runRigSessionLoop({ source, sessionId: "sesn_1", dispatch: vi.fn(), onEvent });

    expect(onEvent).toHaveBeenCalledWith(message);
    expect(onEvent).toHaveBeenCalledWith(idleEndTurn);
  });
});
