import { Form, redirect, useSearchParams } from "react-router";
import { DisplayText } from "~/components/DisplayText";
import { getUserId } from "~/auth/session.server";
import { checkRateLimit, getClientIp } from "~/auth/rateLimit.server";
import { createMagicLinkToken } from "~/magicLink.server";
import { sendMagicLinkEmail } from "~/email.server";
import type { Route } from "./+types/auth.login";

// SECURITY.md flagged this as not-yet-rate-limited: without it, this form
// can mail-bomb an arbitrary inbox (repeated requests for the same email)
// or blast Resend's send volume from one source (many emails, one caller).
// Two independent windows, both counted on every attempt regardless of
// which one is already tripped — an attacker alternating emails from a
// single IP still hits the IP bucket every time, and can't reset it by
// switching targets.
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_RATE_LIMIT = 3;
const IP_RATE_LIMIT = 10;

export function meta() {
  return [{ title: "Sign in — Reading Rig" }];
}

// Already signed in? Don't show the form — bounce straight to wherever
// this login attempt was headed (same redirectTo requireUserId attaches
// when it sends someone here in the first place).
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getUserId(request);
  if (userId) {
    const redirectTo =
      new URL(request.url).searchParams.get("redirectTo") || "/";
    throw redirect(redirectTo);
  }
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim();

  if (!email || !email.includes("@")) {
    return { error: "Enter a valid email address." };
  }

  const withinEmailLimit = checkRateLimit(
    `login:email:${email.toLowerCase()}`,
    EMAIL_RATE_LIMIT,
    LOGIN_RATE_LIMIT_WINDOW_MS,
  );
  const withinIpLimit = checkRateLimit(
    `login:ip:${getClientIp(request)}`,
    IP_RATE_LIMIT,
    LOGIN_RATE_LIMIT_WINDOW_MS,
  );
  if (!withinEmailLimit || !withinIpLimit) {
    return { error: "Too many attempts. Try again in a few minutes." };
  }

  const token = await createMagicLinkToken(email);
  const redirectTo = String(formData.get("redirectTo") ?? "").trim();
  const verifyUrl = new URL("/auth/verify", request.url);
  verifyUrl.searchParams.set("token", token);
  if (redirectTo) verifyUrl.searchParams.set("redirectTo", redirectTo);

  await sendMagicLinkEmail(email, verifyUrl.toString());

  return { sent: true, email };
}

export default function AuthLogin({ actionData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();

  if (actionData?.sent) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
        <h1 className="font-heading text-xl">
          <DisplayText text="Reading Rig" />
        </h1>
        <p className="mt-6 text-sm opacity-70">
          Check <strong>{actionData.email}</strong> for a link to sign in. It
          expires in 15 minutes.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="font-heading text-xl">
        <DisplayText text="Reading Rig" />
      </h1>
      <p className="mt-2 text-sm opacity-60">
        We'll email you a link to sign in — no password.
      </p>
      <Form method="post" className="mt-6 flex flex-col gap-4">
        <input
          type="hidden"
          name="redirectTo"
          value={searchParams.get("redirectTo") ?? ""}
        />
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            className="input"
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            autoFocus
            required
          />
        </div>
        {actionData?.error && (
          <p className="text-sm text-red-600">{actionData.error}</p>
        )}
        <button className="btn btn-primary btn-block" type="submit">
          Send magic link
        </button>
      </Form>
    </main>
  );
}
