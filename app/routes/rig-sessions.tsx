import { db } from "~/db.server";
import { createAnthropicSessionClient } from "~/rig/anthropicSessionClient";
import { createRigSession, listRigSessions } from "~/rig/rigSession";
import { requireUser } from "~/user.server";
import type { Route } from "./+types/rig-sessions";

/**
 * JSON sidecar to rig.tsx's SSE session route — the session picker's data
 * source. GET lists a (user, work)'s past sessions; POST starts a new one.
 * Can't live on rig.tsx itself: that route's GET always returns
 * `text/event-stream`, never JSON. Same reasoning read-content.tsx already
 * establishes next to read.tsx's own loader for exactly this kind of
 * client-fetched sidecar data.
 */

async function requireOwnedWork(userId: string, workId: string) {
  return db.work.findFirstOrThrow({ where: { id: workId, ownerId: userId } });
}

export async function loader({ params }: Route.LoaderArgs) {
  const user = await requireUser();
  const workId = params["*"];
  await requireOwnedWork(user.id, workId);

  const sessions = await listRigSessions(db, { userId: user.id, workId });
  // Only what the picker needs to list and label sessions — never
  // anthropicSessionId itself, which has no business reaching the browser.
  return {
    sessions: sessions.map((session) => ({ id: session.id, createdAt: session.createdAt.toISOString() })),
  };
}

export async function action({ params }: Route.ActionArgs) {
  const user = await requireUser();
  const workId = params["*"];
  await requireOwnedWork(user.id, workId);

  const { agentVersion, createAnthropicSession } = createAnthropicSessionClient();
  const session = await createRigSession(db, { userId: user.id, workId, agentVersion }, createAnthropicSession);

  return { id: session.id, createdAt: session.createdAt.toISOString() };
}
