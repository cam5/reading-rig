import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMagicLinkEmail } from "./email.server";

// No RESEND_API_KEY in `npm test`, so this module's `resend` client is null
// and every call below takes the no-key branch — the only one worth
// testing here, since the other is a single call into Resend's SDK.
const EMAIL = "reader@test.example";
const LINK = "https://reading-rig.com/auth/verify?token=secret-token";

let consoleLog: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
  consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
  vi.restoreAllMocks();
});

describe("sendMagicLinkEmail without a Resend key", () => {
  it("prints the link to the console in local dev, so sign-in still works", async () => {
    await expect(sendMagicLinkEmail(EMAIL, LINK)).resolves.toBeUndefined();

    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(consoleLog.mock.calls[0][0]).toContain("[email]");
    expect(consoleLog.mock.calls[0][0]).toContain(LINK);
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("prints it without a warning on a PR environment, which has no real auth to protect", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "pr-212";
    await expect(sendMagicLinkEmail(EMAIL, LINK)).resolves.toBeUndefined();

    expect(consoleLog.mock.calls[0][0]).toContain(LINK);
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  // Neither environment has RESEND_API_KEY yet, so the logged link is how
  // sign-in works there — refusing would 500 every POST /auth/login. What
  // changes is that the log now says, once, that it's holding a credential.
  it.each(["production", "staging-qa"])(
    "still prints the link on %s, with one warning that carries neither the link nor the address",
    async (environmentName) => {
      process.env.RAILWAY_ENVIRONMENT_NAME = environmentName;

      await expect(sendMagicLinkEmail(EMAIL, LINK)).resolves.toBeUndefined();

      expect(consoleLog).toHaveBeenCalledTimes(1);
      expect(consoleLog.mock.calls[0][0]).toContain(LINK);
      expect(consoleWarn).toHaveBeenCalledTimes(1);
      const warning = JSON.stringify(consoleWarn.mock.calls);
      expect(warning).toContain("[email]");
      expect(warning).not.toContain("secret-token");
      expect(warning).not.toContain(EMAIL);
    },
  );
});
