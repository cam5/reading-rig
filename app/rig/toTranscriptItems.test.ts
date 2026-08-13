import { describe, expect, it } from "vitest";
import { qaTurnEvents, toolUseTurnEvents, memoryTurnEvents, streamingTurnEvents } from "./__fixtures__/referenceSessionEvents";
import { toTranscriptItems } from "./toTranscriptItems";

describe("toTranscriptItems", () => {
  it("maps a plain turn to a status item and the two messages", () => {
    const items = toTranscriptItems(qaTurnEvents);
    expect(items.map((item) => item.kind)).toEqual(["status", "message", "message"]);
    expect(items[1]).toMatchObject({ role: "user", text: "What's happening in this passage?" });
    expect(items[2]).toMatchObject({ role: "agent" });
  });

  it("pairs a tool_use with its later tool_result instead of leaving it pending", () => {
    const items = toTranscriptItems(toolUseTurnEvents);
    const tool = items.find((item) => item.kind === "tool");
    expect(tool).toMatchObject({
      name: "web_search",
      toolKind: "builtin",
      status: "success",
      resultSummary: "Karl Marx. Capital Volume One Part I: Commodities and Money",
    });
  });

  it("keeps a tool item pending when its result hasn't arrived yet", () => {
    const useOnly = toolUseTurnEvents.filter((event) => event.type !== "agent.tool_result");
    const tool = toTranscriptItems(useOnly).find((item) => item.kind === "tool");
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

  it("builds one streaming message item from event_start, fills it in as event_delta frames arrive", () => {
    const [start, delta1] = streamingTurnEvents;
    const items = toTranscriptItems([start, delta1]);
    expect(items).toEqual([{ kind: "message", id: "sevt_fixture_stream1", role: "agent", text: "Marx spent around", streaming: true }]);
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
    const agentMessage = items.find((item) => item.kind === "message" && item.role === "agent");
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
    const agentMessage = items.find((item) => item.kind === "message" && item.role === "agent");
    expect(agentMessage).toMatchObject({ simulateReveal: false });
  });

  it("never flags a user.message for simulated reveal — the reader typed that themselves", () => {
    const items = toTranscriptItems(qaTurnEvents);
    const userMessage = items.find((item) => item.kind === "message" && item.role === "user");
    expect((userMessage as { simulateReveal?: boolean })?.simulateReveal).toBeFalsy();
  });

  it("flags a reconciled streaming item for simulated reveal when event_start opened but no event_delta ever followed", () => {
    const [start, , , bufferedMessage] = streamingTurnEvents;
    const items = toTranscriptItems([start, bufferedMessage]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ simulateReveal: true, text: "Marx spent around seventeen years on the first volume." });
  });
});
