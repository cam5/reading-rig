import { describe, expect, it } from "vitest";
import { SendFailedError, sendErrorMessage } from "./useRigLiveSession";

describe("sendErrorMessage — what a failed send tells the reader to do next", () => {
  it("points at starting a new session when this one is gone (404)", () => {
    expect(sendErrorMessage(new SendFailedError(404))).toBe(
      "This session is no longer available — start a new one to keep going.",
    );
  });

  it("points at signing back in when the reader's session lapsed (401)", () => {
    expect(sendErrorMessage(new SendFailedError(401))).toBe(
      "You've been signed out — reload and sign in again.",
    );
  });

  it("says to wait a moment when rate-limited (429)", () => {
    expect(sendErrorMessage(new SendFailedError(429))).toBe(
      "The Rig is busy right now — try again in a moment.",
    );
  });

  it("shows the server's own reason for a 503 when it sent one", () => {
    const reason = "The Rig isn't set up in this environment.";
    expect(sendErrorMessage(new SendFailedError(503, reason))).toBe(reason);
  });

  it("falls back to generic unavailable copy for a 503 with no reason", () => {
    expect(sendErrorMessage(new SendFailedError(503))).toBe(
      "The Rig isn't available right now — try again in a moment.",
    );
  });

  it("keeps the generic line for a network error or any other status", () => {
    const generic = "Couldn't send — try again.";
    expect(sendErrorMessage(new TypeError("Failed to fetch"))).toBe(generic);
    expect(sendErrorMessage(new SendFailedError(500))).toBe(generic);
  });
});
