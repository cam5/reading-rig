import type { PrismaClient, RigSession } from "../../generated/prisma/client";

export type CreateAnthropicSession = () => Promise<{ anthropicSessionId: string }>;

/**
 * One long-lived Anthropic session per (user, work): looked up first,
 * created only the first time the reader opens the Rig for this book. The
 * build plan's phrase for this is "resumed on return" — the row, once
 * written, is never replaced; looking it up again *is* the resumption.
 *
 * `createAnthropicSession` is injected rather than this function calling
 * `client.beta.sessions.create` itself, so the lookup-or-create logic has
 * real Vitest coverage against a real (test) Prisma database without any
 * network access — the same seam #24/#25 already draw between pure logic
 * and network glue. The route (app/routes/rig.tsx) is what supplies the
 * real callback.
 */
export async function getOrCreateRigSession(
  db: PrismaClient,
  params: { userId: string; workId: string; agentVersion: string },
  createAnthropicSession: CreateAnthropicSession,
): Promise<RigSession> {
  const existing = await db.rigSession.findUnique({
    where: { userId_workId: { userId: params.userId, workId: params.workId } },
  });
  if (existing) return existing;

  const { anthropicSessionId } = await createAnthropicSession();

  try {
    return await db.rigSession.create({
      data: {
        userId: params.userId,
        workId: params.workId,
        anthropicSessionId,
        agentVersion: params.agentVersion,
      },
    });
  } catch (error) {
    // A second caller could race this same first-open moment (e.g. a
    // double-mount SSE connect). @@unique([userId, workId]) turns a
    // concurrent duplicate create into a thrown error rather than a
    // second, silently-orphaned Anthropic session — fall back to
    // whichever row won the race instead of surfacing that as a failure.
    const winner = await db.rigSession.findUnique({
      where: { userId_workId: { userId: params.userId, workId: params.workId } },
    });
    if (winner) return winner;
    throw error;
  }
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
