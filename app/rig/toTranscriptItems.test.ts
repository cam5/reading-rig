import { describe, expect, it } from "vitest";
import {
  qaTurnEvents,
  toolUseTurnEvents,
  memoryTurnEvents,
  streamingTurnEvents,
} from "./__fixtures__/referenceSessionEvents";
import { toTranscriptItems } from "./toTranscriptItems";

describe("toTranscriptItems", () => {
  it("maps a plain turn to just the two messages, dropping session.status_running", () => {
    const items = toTranscriptItems(qaTurnEvents);
    expect(items.map((item) => item.kind)).toEqual(["message", "message"]);
    expect(items[0]).toMatchObject({
      role: "user",
      text: "What's happening in this passage?",
    });
    expect(items[1]).toMatchObject({ role: "agent" });
  });

  it("pairs a tool_use with its later tool_result instead of leaving it pending", () => {
    const items = toTranscriptItems(toolUseTurnEvents);
    const tool = items.find((item) => item.kind === "tool");
    expect(tool).toMatchObject({
      name: "web_search",
      toolKind: "builtin",
      status: "success",
      resultSummary:
        "Karl Marx. Capital Volume One Part I: Commodities and Money",
    });
  });

  it("keeps a tool item pending when its result hasn't arrived yet", () => {
    const useOnly = toolUseTurnEvents.filter(
      (event) => event.type !== "agent.tool_result",
    );
    const tool = toTranscriptItems(useOnly).find(
      (item) => item.kind === "tool",
    );
    expect(tool).toMatchObject({ status: "pending" });
    expect((tool as { resultSummary?: string })?.resultSummary).toBeUndefined();
  });

  it("routes a memory-store-prefixed tool call to a memory item, not a generic tool item", () => {
    const items = toTranscriptItems(memoryTurnEvents);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "memory",
      action: "read",
      path: "/mnt/memory/reader-preferences/cameron.md",
      status: "success",
    });
  });

  it("includes two agent.thinking beats from the real tool-use turn", () => {
    const items = toTranscriptItems(toolUseTurnEvents);
    expect(items.filter((item) => item.kind === "thinking")).toHaveLength(2);
  });

  it("closes each agent.thinking beat's duration using the very next event's processed_at", () => {
    const items = toTranscriptItems(toolUseTurnEvents);
    const thinkingItems = items.filter((item) => item.kind === "thinking");
    const rawThinkingEvents = toolUseTurnEvents.filter(
      (event) => event.type === "agent.thinking",
    );
    expect(thinkingItems).toHaveLength(rawThinkingEvents.length);
    // Whatever event immediately follows an agent.thinking event in the raw
    // stream is what closes it — mirrors toTranscriptItems' "any next event
    // closes the open beat" rule, not just a dedicated "thinking ended"
    // event type (there isn't one).
    rawThinkingEvents.forEach((thinkingEvent, index) => {
      const eventIndex = toolUseTurnEvents.indexOf(thinkingEvent);
      const closingEvent = toolUseTurnEvents[eventIndex + 1];
      const expectedDuration =
        Date.parse(closingEvent.processed_at as string) -
        Date.parse(thinkingEvent.processed_at as string);
      expect(thinkingItems[index]).toMatchObject({
        startedAt: thinkingEvent.processed_at,
        durationMs: expectedDuration,
      });
    });
  });

  it("leaves an agent.thinking beat unresolved when it's still the most recent event (turn in progress)", () => {
    const firstThinkingIndex = toolUseTurnEvents.findIndex(
      (event) => event.type === "agent.thinking",
    );
    const stillThinking = toolUseTurnEvents.slice(0, firstThinkingIndex + 1);
    const items = toTranscriptItems(stillThinking);
    const thinking = items.find((item) => item.kind === "thinking");
    expect(thinking).toMatchObject({
      startedAt: stillThinking[firstThinkingIndex].processed_at,
    });
    // A never-closed thinking item simply never gets a `durationMs` key
    // assigned (see toTranscriptItems' `openThinking` handling) — toMatchObject
    // with an expected `undefined` requires the key to literally be present
    // with that value, so check the value directly instead.
    expect((thinking as { durationMs?: number } | undefined)?.durationMs).toBe(
      undefined,
    );
  });

  it("closes an earlier thinking beat when a second thinking beat starts, leaving only the later one open", () => {
    const thinkingIndices = toolUseTurnEvents.reduce<number[]>(
      (indices, event, index) =>
        event.type === "agent.thinking" ? [...indices, index] : indices,
      [],
    );
    const [, secondThinkingIndex] = thinkingIndices;
    const upToSecondBeat = toolUseTurnEvents.slice(0, secondThinkingIndex + 1);
    const items = toTranscriptItems(upToSecondBeat);
    const thinkingItems = items.filter((item) => item.kind === "thinking");
    expect(thinkingItems).toHaveLength(2);
    expect(thinkingItems[0]).toMatchObject({ durationMs: expect.any(Number) });
    expect((thinkingItems[1] as { durationMs?: number }).durationMs).toBe(
      undefined,
    );
  });

  it("builds one streaming message item from event_start, fills it in as event_delta frames arrive", () => {
    const [start, delta1] = streamingTurnEvents;
    const items = toTranscriptItems([start, delta1]);
    expect(items).toEqual([
      {
        kind: "message",
        id: "sevt_fixture_stream1",
        role: "agent",
        text: "Marx spent around",
        streaming: true,
      },
    ]);
  });

  it("reconciles the streaming item with the buffered agent.message and clears streaming", () => {
    const items = toTranscriptItems(streamingTurnEvents);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "message",
      id: "sevt_fixture_stream1",
      role: "agent",
      text: "Marx spent around seventeen years on the first volume.",
      streaming: false,
      // Real event_delta fragments landed before the buffer did — no need
      // for RigMessage to fake a reveal on top of what already streamed.
      simulateReveal: false,
    });
  });

  it("flags an agent.message with no preceding event_start for simulated reveal — it arrived as one blob", () => {
    const items = toTranscriptItems(qaTurnEvents);
    const agentMessage = items.find(
      (item) => item.kind === "message" && item.role === "agent",
    );
    expect(agentMessage).toMatchObject({ simulateReveal: true });
  });

  it("never flags an agent.message surfaced by history backfill for simulated reveal, even with no preceding event_start", () => {
    // Same shape as the live case above, but stamped live: false the way
    // rig.tsx's SSE route marks an event that came from a resumed
    // session's history replay rather than the live tail (sessionLoop.ts's
    // onEvent). A reader reopening a chat should see the old reply appear
    // whole, not replay the typewriter animation.
    const backfilled = qaTurnEvents.map((event) => ({ ...event, live: false }));
    const items = toTranscriptItems(backfilled);
    const agentMessage = items.find(
      (item) => item.kind === "message" && item.role === "agent",
    );
    expect(agentMessage).toMatchObject({ simulateReveal: false });
  });

  it("never flags a user.message for simulated reveal — the reader typed that themselves", () => {
    const items = toTranscriptItems(qaTurnEvents);
    const userMessage = items.find(
      (item) => item.kind === "message" && item.role === "user",
    );
    expect(
      (userMessage as { simulateReveal?: boolean })?.simulateReveal,
    ).toBeFalsy();
  });

  it("flags a reconciled streaming item for simulated reveal when event_start opened but no event_delta ever followed", () => {
    const [start, , , bufferedMessage] = streamingTurnEvents;
    const items = toTranscriptItems([start, bufferedMessage]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      simulateReveal: true,
      text: "Marx spent around seventeen years on the first volume.",
    });
  });
});
