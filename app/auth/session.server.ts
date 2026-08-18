import { createCookieSessionStorage, redirect } from "react-router";
import { db } from "../db.server";
import { requiresRealAuth } from "../env.server";

// SESSION_SECRET signs the cookie so a client can't forge or tamper with
// its contents (still plaintext-readable, just unforgeable) — see
// app/magicLink.server.ts for the token that actually authenticates a
// sign-in; this only protects the session that results from one. Required
// wherever real auth is required (production and staging-qa — see
// requiresRealAuth) so a real deploy can't silently run unsigned.
//
// Keyed off requiresRealAuth(), not NODE_ENV: react-router-serve (`npm
// start`) always sets NODE_ENV=production, including for Railway PR
// environments — a plain NODE_ENV check made this throw on every Railway
// deploy, not just the ones that need it, crash-looping any PR environment
// that (correctly) never had this secret configured.
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret && requiresRealAuth()) {
  throw new Error("SESSION_SECRET must be set in production.");
}

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__rig_session",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secrets: [sessionSecret ?? "dev-only-insecure-secret"],
    secure: process.env.NODE_ENV === "production",
    // A month — long enough that a personal reading app doesn't keep
    // bouncing you back to /auth/login, short enough that a stolen cookie
    // doesn't grant access forever.
    maxAge: 60 * 60 * 24 * 30,
  },
});

const USER_ID_KEY = "userId";

export async function getUserId(request: Request): Promise<string | null> {
  const session = await sessionStorage.getSession(
    request.headers.get("Cookie"),
  );
  const userId = session.get(USER_ID_KEY);
  return typeof userId === "string" ? userId : null;
}

// Redirects to /auth/login (preserving where the request was headed via
// ?redirectTo) rather than throwing a bare 401 — every call site is a
// route loader/action, and react-router treats a thrown redirect Response
// exactly like a returned one.
export async function requireUserId(request: Request): Promise<string> {
  const userId = await getUserId(request);
  if (userId) return userId;

  // Where real auth isn't required (local dev, CI, Lighthouse, PR
  // environments — see requiresRealAuth) there's only ever the one seeded
  // user (prisma/seed.ts), and nothing in a CI runner can click a
  // magic-link email. Falls back to it here rather than in getUserId so
  // /auth/login itself — which calls getUserId, not this — still renders
  // normally if you want to exercise the real flow locally. Same "there's
  // only really one person running this" assumption requireUser() used to
  // make everywhere before real accounts existed (scripts/ingest.ts makes
  // it too, for the same reason).
  if (!requiresRealAuth()) {
    const seededUser = await db.user.findFirst({
      orderBy: { createdAt: "asc" },
    });
    if (seededUser) return seededUser.id;
  }

  const url = new URL(request.url);
  const redirectTo = `${url.pathname}${url.search}`;
  const params = new URLSearchParams({ redirectTo });
  throw redirect(`/auth/login?${params}`);
}

// Returns the redirect rather than throwing it — unlike requireUserId,
// every call site is already in return position (the last thing a login
// or logout action does), and returning keeps the async-throw-is-really-a-
// rejection footgun out of it: `throw asyncFn()` throws the pending
// Promise itself, not what it resolves to, unless the caller awaits first.
export async function createUserSession(
  request: Request,
  userId: string,
  redirectTo: string,
) {
  const session = await sessionStorage.getSession(
    request.headers.get("Cookie"),
  );
  session.set(USER_ID_KEY, userId);
  return redirect(redirectTo, {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
  });
}

export async function destroyUserSession(request: Request) {
  const session = await sessionStorage.getSession(
    request.headers.get("Cookie"),
  );
  return redirect("/auth/login", {
    headers: { "Set-Cookie": await sessionStorage.destroySession(session) },
  });
}
