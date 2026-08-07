import type { PrismaClient, RigSession } from "../../generated/prisma/client";

export type CreateAnthropicSession = () => Promise<{ anthropicSessionId: string }>;

/**
 * Every RigSession for a (user, work), most recent first — the session
 * picker's listing, and also what `getOrCreateActiveRigSession` below reads
 * to find "the" default session without a dedicated query of its own.
 */
export async function listRigSessions(
  db: PrismaClient,
  params: { userId: string; workId: string },
): Promise<RigSession[]> {
  return db.rigSession.findMany({
    where: { userId: params.userId, workId: params.workId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Starts a brand-new Anthropic session and a brand-new RigSession row for
 * it, unconditionally — the session picker's "start a new conversation"
 * action, and also what `getOrCreateActiveRigSession` falls back to on a
 * (user, work)'s very first open. No race-fallback needed here the way the
 * old single-session-per-work version needed one: without
 * `@@unique([userId, workId])`, two callers racing this just produce two
 * sessions, which is a valid (if slightly wasteful) outcome now rather than
 * a constraint violation.
 *
 * `createAnthropicSession` is injected rather than this function calling
 * `client.beta.sessions.create` itself, so this has real Vitest coverage
 * against a real (test) Prisma database without any network access — the
 * same seam #24/#25 already draw between pure logic and network glue. The
 * route (app/routes/rig.tsx) is what supplies the real callback.
 */
export async function createRigSession(
  db: PrismaClient,
  params: { userId: string; workId: string; agentVersion: string },
  createAnthropicSession: CreateAnthropicSession,
): Promise<RigSession> {
  const { anthropicSessionId } = await createAnthropicSession();
  return db.rigSession.create({
    data: {
      userId: params.userId,
      workId: params.workId,
      anthropicSessionId,
      agentVersion: params.agentVersion,
    },
  });
}

/**
 * The session a plain "open the Rig for this book" (no session id in the
 * URL) resolves to: the most recently created RigSession for this (user,
 * work), or a freshly created one if there isn't one yet. This is what used
 * to be the *only* mode `getOrCreateRigSession` supported — now one of two
 * ways in, alongside `app/routes/rig.tsx` resolving a specific
 * `?session=<id>` via `listRigSessions`/ownership check instead of this.
 */
export async function getOrCreateActiveRigSession(
  db: PrismaClient,
  params: { userId: string; workId: string; agentVersion: string },
  createAnthropicSession: CreateAnthropicSession,
): Promise<RigSession> {
  const mostRecent = await db.rigSession.findFirst({
    where: { userId: params.userId, workId: params.workId },
    orderBy: { createdAt: "desc" },
  });
  if (mostRecent) return mostRecent;
  return createRigSession(db, params, createAnthropicSession);
}

/**
 * A specific RigSession by id, scoped to (userId, workId) — the session
 * picker's "resume this exact one" path, as opposed to
 * `getOrCreateActiveRigSession`'s "give me whichever is most recent."
 * Ownership is checked here rather than left to the caller: `null` covers
 * both "no such row" and "that row belongs to someone else, or a different
 * work" identically, so a reader can't probe another user's session ids by
 * timing a 404 against a 403.
 */
export async function getRigSessionById(
  db: PrismaClient,
  params: { userId: string; workId: string; sessionId: string },
): Promise<RigSession | null> {
  const session = await db.rigSession.findUnique({ where: { id: params.sessionId } });
  if (!session || session.userId !== params.userId || session.workId !== params.workId) return null;
  return session;
}

/**
 * Points an existing RigSession row at a brand-new Anthropic session —
 * the recovery path for when Anthropic reports the session named by
 * `existing.anthropicSessionId` no longer exists (expired, or deleted
 * server-side). "The row, once written, is never replaced" — this module's
 * original framing — held only as long as the Anthropic session itself
 * did; once it's gone there's no transcript left to resume, and replacing
 * the row is what stops every future request for this (user, work) from
 * 404ing forever (#113). See `withRigSessionRecovery` for where this gets
 * called.
 */
export async function replaceRigSession(
  db: PrismaClient,
  existing: RigSession,
  createAnthropicSession: CreateAnthropicSession,
): Promise<RigSession> {
  const { anthropicSessionId } = await createAnthropicSession();
  return db.rigSession.update({
    where: { id: existing.id },
    data: { anthropicSessionId },
  });
}

/**
 * Runs `operation` against `rigSession`; if it fails because Anthropic says
 * the session itself is gone (per `isSessionNotFoundError`), replaces the
 * session (`replaceRigSession`) and retries `operation` exactly once
 * against the fresh row. Retried only once — a second failure right after
 * creating a new session points at something other than a stale id, and
 * should surface rather than loop.
 *
 * `isSessionNotFoundError` is injected rather than imported so this stays
 * network-agnostic like the rest of this file; the real predicate lives in
 * anthropicSessionSource.ts, next to the Anthropic error shapes it reads.
 */
export async function withRigSessionRecovery<T>(
  db: PrismaClient,
  rigSession: RigSession,
  createAnthropicSession: CreateAnthropicSession,
  isSessionNotFoundError: (error: unknown) => boolean,
  operation: (rigSession: RigSession) => Promise<T>,
): Promise<T> {
  try {
    return await operation(rigSession);
  } catch (error) {
    if (!isSessionNotFoundError(error)) throw error;
    const replaced = await replaceRigSession(db, rigSession, createAnthropicSession);
    return operation(replaced);
  }
}
