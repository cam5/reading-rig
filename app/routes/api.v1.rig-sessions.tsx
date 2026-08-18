import { db } from "~/db.server";
import { track, trackContext, canonicalRequestUrl } from "~/analytics.server";
import {
  createAnthropicSessionClient,
  rigUnavailableReason,
} from "~/rig/anthropicSessionClient";
import { createRigSession, listRigSessions } from "~/rig/rigSession";
import { requireApiUser } from "~/user.server";
import {
  assertWorkReadableBy,
  fetchOwnedWork,
} from "~/domain/reading/assertWorkReadableBy.server";
import {
  rigSessionCreateResponseSchema,
  rigSessionsResponseSchema,
} from "~/domain/api/schemas/rigSessions.server";
import type { Route } from "./+types/api.v1.rig-sessions";

/**
 * JSON sidecar to rig.tsx's SSE session route — the session picker's data
 * source. GET lists a (user, work)'s past sessions; POST starts a new one.
 * Can't live on rig.tsx itself: that route's GET always returns
 * `text/event-stream`, never JSON. Same reasoning read-content.tsx already
 * establishes next to read.tsx's own loader for exactly this kind of
 * client-fetched sidecar data.
 */

export async function loader({ params, request }: Route.LoaderArgs) {
  const user = await requireApiUser(request);
  const workId = params["*"];
  await assertWorkReadableBy(db, user.id, workId);

  const sessions = await listRigSessions(db, { userId: user.id, workId });
  // Only what the picker needs to list and label sessions — never
  // anthropicSessionId itself, which has no business reaching the browser.
  return rigSessionsResponseSchema.parse({
    sessions: sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      anchorGlobalOrdinal: session.anchorGlobalOrdinal,
    })),
    // Checked here, on every panel open, rather than only discovered when
    // an auto-created session's POST fails — see rigUnavailableReason's
    // doc comment. `null` means the Rig is usable.
    rigUnavailableReason: rigUnavailableReason(),
  });
}

export async function action({ params, request }: Route.ActionArgs) {
  const user = await requireApiUser(request);
  const workId = params["*"];
  const work = await fetchOwnedWork(db, user.id, workId);

  const { agentVersion, createAnthropicSession } =
    await createAnthropicSessionClient(db);
  const session = await createRigSession(
    db,
    { userId: user.id, workId, agentVersion },
    createAnthropicSession,
  );

  // listRigSessions rather than a second createRigSession-scoped counter:
  // this is the same list the picker itself reads, so "sessionCount" here
  // can never drift from what the UI shows.
  const sessionCount = await listRigSessions(db, {
    userId: user.id,
    workId,
  }).then((sessions) => sessions.length);
  await track(
    { name: "rig_session_started", workId, sessionCount },
    trackContext(user.id, canonicalRequestUrl(request), work.title),
  );

  return rigSessionCreateResponseSchema.parse({
    id: session.id,
    createdAt: session.createdAt.toISOString(),
    anchorGlobalOrdinal: session.anchorGlobalOrdinal,
  });
}
