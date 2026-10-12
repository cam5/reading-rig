import { Resend } from "resend";
import { requiresRealAuth } from "./env.server";
import { log } from "./log.server";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// "onboarding@resend.dev" only delivers to the Resend account's own
// verified address — fine for kicking the tyres, but a real deploy needs
// RESEND_FROM_EMAIL set to an address on a domain verified with Resend.
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

// No-op-without-a-key, same shape as PostHog in app/analytics.server.ts:
// without RESEND_API_KEY, dev/test/CI never need a Resend account — the
// magic link just prints to the console instead, so the sign-in flow is
// still exercisable end-to-end from a terminal.
//
// A live magic link in a log is a working credential for whoever can read
// that log, so the fallback stops where real auth starts: production and
// staging-qa refuse to send (and say why, without the link) rather than
// print one. Keyed off requiresRealAuth(), not NODE_ENV, for the same
// reason session.server.ts is — `npm start` sets NODE_ENV=production on
// PR environments too.
export async function sendMagicLinkEmail(
  email: string,
  magicLinkUrl: string,
): Promise<void> {
  if (!resend) {
    if (requiresRealAuth()) {
      log.error(
        "email",
        "RESEND_API_KEY not set — refusing to log a magic link in a real-auth environment",
      );
      throw new Error("Failed to send magic link email: email not configured");
    }
    log.info(
      "email",
      `RESEND_API_KEY not set — magic link for ${email}:\n  ${magicLinkUrl}`,
    );
    return;
  }

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "Sign in to Reading Rig",
    text: `Click to sign in to Reading Rig:\n\n${magicLinkUrl}\n\nThis link expires in 15 minutes. If you didn't request it, ignore this email.`,
  });

  if (error) {
    throw new Error(`Failed to send magic link email: ${error.message}`);
  }
}
