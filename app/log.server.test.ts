import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "./log.server";

let consoleLog: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("log", () => {
  it("prefixes every line with its scope in brackets", () => {
    log.info("rig-session", "stream opened");
    expect(consoleLog).toHaveBeenCalledWith("[rig-session] stream opened");
  });

  it("maps each level onto its own console method, and only that one", () => {
    log.info("scope", "info line");
    log.warn("scope", "warn line");
    log.error("scope", "error line");

    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(consoleLog).toHaveBeenCalledWith("[scope] info line");
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleWarn).toHaveBeenCalledWith("[scope] warn line");
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("[scope] error line");
  });

  it("appends fields as key=value pairs, quoting only what needs it", () => {
    log.warn("upload", "could not parse", {
      userId: "user_1",
      sizeBytes: 1024,
      retried: false,
      title: "A Tale of Two Cities",
    });

    expect(consoleWarn).toHaveBeenCalledWith(
      '[upload] could not parse userId=user_1 sizeBytes=1024 retried=false title="A Tale of Two Cities"',
    );
  });

  it("drops undefined fields rather than printing them", () => {
    log.info("scope", "message", { workId: "work-1", sessionId: undefined });
    expect(consoleLog).toHaveBeenCalledWith("[scope] message workId=work-1");
  });

  // The stack trace is the point: an Error rendered into the line would
  // arrive in Railway's logs as just its message.
  it("passes an Error through as its own last argument, untouched", () => {
    const error = new Error("db down");
    log.error("rig-dispatch", "tool call threw", { toolName: "x", error });

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "[rig-dispatch] tool call threw toolName=x",
      error,
    );
    expect(consoleError.mock.calls[0][1]).toBe(error);
  });

  it("passes a non-Error thrown value through the same way", () => {
    log.warn("scope", "message", { error: "just a string" });
    expect(consoleWarn).toHaveBeenCalledWith(
      "[scope] message",
      "just a string",
    );
  });
});
