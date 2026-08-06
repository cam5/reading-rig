import { NotFoundError } from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { isSessionNotFoundError } from "./anthropicSessionSource";

function makeNotFoundError(message: string): NotFoundError {
  return new NotFoundError(
    404,
    { type: "error", error: { type: "not_found_error", message } },
    undefined,
    new Headers(),
  );
}

describe("isSessionNotFoundError", () => {
  it("recognizes Anthropic's session-not-found 404", () => {
    expect(isSessionNotFoundError(makeNotFoundError("Session not found: sesn_01Qbgmny781yzfY1GZe1rpZV"))).toBe(true);
  });

  it("rejects a 404 for a different resource, e.g. the agent itself", () => {
    expect(isSessionNotFoundError(makeNotFoundError("Agent not found: agent_016CY1oU3hVE735o7djDft5f"))).toBe(false);
  });

  it("rejects a NotFoundError with no parseable body", () => {
    expect(isSessionNotFoundError(new NotFoundError(404, undefined, "not found", new Headers()))).toBe(false);
  });

  it("rejects errors that aren't Anthropic's NotFoundError", () => {
    expect(isSessionNotFoundError(new Error("Session not found: sesn_x"))).toBe(false);
    expect(isSessionNotFoundError("Session not found")).toBe(false);
    expect(isSessionNotFoundError(null)).toBe(false);
    expect(isSessionNotFoundError(undefined)).toBe(false);
  });
});
