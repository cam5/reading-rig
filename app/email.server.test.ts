import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMagicLinkEmail } from "./email.server";

// No RESEND_API_KEY in `npm test`, so this module's `resend` client is null
// and every call below takes the no-key branch — the only one worth
// testing here, since the other is a single call into Resend's SDK.
const EMAIL = "reader@test.example";
const LINK = "https://reading-rig.com/auth/verify?token=secret-token";

let consoleLog: ReturnType<typeof vi.spyOn>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
  consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
  vi.restoreAllMocks();
});

function everythingLogged(): string {
  return JSON.stringify([...consoleLog.mock.calls, ...consoleError.mock.calls]);
}

describe("sendMagicLinkEmail without a Resend key", () => {
  it("prints the link to the console in local dev, so sign-in still works", async () => {
    await expect(sendMagicLinkEmail(EMAIL, LINK)).resolves.toBeUndefined();

    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(consoleLog.mock.calls[0][0]).toContain("[email]");
    expect(consoleLog.mock.calls[0][0]).toContain(LINK);
  });

  it("still prints it on a PR environment, which has no real auth to protect", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "pr-212";
    await expect(sendMagicLinkEmail(EMAIL, LINK)).resolves.toBeUndefined();
    expect(everythingLogged()).toContain(LINK);
  });

  // A magic link in a log is a working credential for anyone who can read
  // that log.
  it.each(["production", "staging-qa"])(
    "refuses, and logs neither the link nor the address, on %s",
    async (environmentName) => {
      process.env.RAILWAY_ENVIRONMENT_NAME = environmentName;

      await expect(sendMagicLinkEmail(EMAIL, LINK)).rejects.toThrow(
        /email not configured/,
      );

      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleLog).not.toHaveBeenCalled();
      expect(everythingLogged()).not.toContain("secret-token");
      expect(everythingLogged()).not.toContain(EMAIL);
    },
  );
});
