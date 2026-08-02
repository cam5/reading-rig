import { describe, expect, it } from "vitest";
import { qaTurnEvents, toolUseTurnEvents, memoryTurnEvents } from "./__fixtures__/referenceSessionEvents";
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
});
