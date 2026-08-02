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
