import { describe, expect, it } from "vitest";
import { extractAgentMessageText, isEndOfTurn } from "./rigAnswerEvents";

describe("extractAgentMessageText", () => {
  it("joins the text blocks of an agent.message event", () => {
    const event = {
      type: "agent.message",
      id: "evt_1",
      processed_at: "2026-07-26T00:00:00Z",
      content: [{ type: "text", text: "Not in the wood, and not in the labour either." }],
    };
    expect(extractAgentMessageText(event)).toBe("Not in the wood, and not in the labour either.");
  });

  it("joins multiple text blocks with no separator, same as their own concatenation", () => {
    const event = {
      type: "agent.message",
      id: "evt_1",
      processed_at: "now",
      content: [
        { type: "text", text: "Part one. " },
        { type: "text", text: "Part two." },
      ],
    };
    expect(extractAgentMessageText(event)).toBe("Part one. Part two.");
  });

  it("returns null for any other event type", () => {
    expect(extractAgentMessageText({ type: "agent.thinking", id: "evt_2" })).toBeNull();
    expect(extractAgentMessageText({ type: "session.status_idle", id: "evt_3" })).toBeNull();
  });

  it("returns null when content is missing or not an array", () => {
    expect(extractAgentMessageText({ type: "agent.message", id: "evt_4" })).toBeNull();
    expect(extractAgentMessageText({ type: "agent.message", id: "evt_5", content: "not an array" })).toBeNull();
  });

  it("returns null for a message whose blocks carry no text (all non-text, or empty)", () => {
    expect(extractAgentMessageText({ type: "agent.message", id: "evt_6", content: [] })).toBeNull();
    expect(
      extractAgentMessageText({
        type: "agent.message",
        id: "evt_7",
        content: [{ type: "image", source: {} }],
      }),
    ).toBeNull();
  });
});

describe("isEndOfTurn", () => {
  it("is true for session.status_idle with stop_reason.type end_turn", () => {
    const event = {
      type: "session.status_idle",
      id: "evt_1",
      processed_at: "now",
      stop_reason: { type: "end_turn" },
    };
    expect(isEndOfTurn(event)).toBe(true);
  });

  it("is false for requires_action — the turn isn't actually over", () => {
    const event = {
      type: "session.status_idle",
      id: "evt_2",
      stop_reason: { type: "requires_action", event_ids: ["evt_x"] },
    };
    expect(isEndOfTurn(event)).toBe(false);
  });

  it("is false for retries_exhausted — ended, but not with an answer", () => {
    const event = { type: "session.status_idle", id: "evt_3", stop_reason: { type: "retries_exhausted" } };
    expect(isEndOfTurn(event)).toBe(false);
  });

  it("is false for any other event type", () => {
    expect(isEndOfTurn({ type: "agent.message", id: "evt_4", content: [] })).toBe(false);
    expect(isEndOfTurn({ type: "session.status_terminated", id: "evt_5" })).toBe(false);
  });
});
