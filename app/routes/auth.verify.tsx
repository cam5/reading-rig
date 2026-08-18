import { db } from "~/db.server";
import { consumeMagicLinkToken } from "~/magicLink.server";
import { createUserSession } from "~/auth/session.server";
import { grantSeedWorks } from "~/domain/work/grantSeedWorks.server";
import { track, canonicalRequestUrl } from "~/analytics.server";
import type { Route } from "./+types/auth.verify";

const ERROR_COPY: Record<"invalid" | "expired" | "used" | "missing", string> = {
  missing: "That link is missing its token.",
  invalid: "That link isn't valid — it may have been copied wrong.",
  expired: "That link has expired. Request a new one.",
  used: "That link has already been used. Request a new one.",
};

// Loader, not action: a magic link is a GET the user's mail client (or the
// user) navigates to directly, not a form submission. Clicking a link
// twice (a forwarded email, a mail scanner prefetching it) is exactly what
// consumeMagicLinkToken's single-use check guards against.
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) return { error: ERROR_COPY.missing };

  const result = await consumeMagicLinkToken(token);
  if ("error" in result) return { error: ERROR_COPY[result.error] };

  // Looked up before creating, rather than a single upsert, so this
  // request itself knows whether it just signed someone up or signed them
  // back in — see `signed_up`/`signed_in` below. SQLite's single-writer
  // semantics mean there's no real create/create race to worry about here
  // the way there would be against a concurrent-writer database.
  const existingUser = await db.user.findUnique({
    where: { email: result.email },
  });
  const user =
    existingUser ?? (await db.user.create({ data: { email: result.email } }));
  // Every sign-in, not just the first — grantSeedWorks is upsert-based so
  // this is a no-op once a user already has the seed shelf.
  await grantSeedWorks(db, user.id);

  const redirectTo = url.searchParams.get("redirectTo") || "/";
  await track(
    {
      name: existingUser ? "signed_in" : "signed_up",
      hasRedirectTo: url.searchParams.has("redirectTo"),
    },
    { distinctId: user.id, currentUrl: canonicalRequestUrl(request) },
  );
  return createUserSession(request, user.id, redirectTo);
}

export default function AuthVerify({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <p className="text-sm opacity-70">{loaderData.error}</p>
      <a className="btn btn-primary btn-block mt-6" href="/auth/login">
        Back to sign in
      </a>
    </main>
  );
}
