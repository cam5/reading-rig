import { useCallback, useEffect, useState } from "react";

export type RigSessionSummary = {
  id: string;
  createdAt: string;
};

type UseRigSessionsResult = {
  /** `null` while the initial fetch hasn't resolved yet — distinct from
   * `[]`, a (user, work) that's genuinely never had a session. Callers that
   * need to tell "still loading" from "loaded, empty" (RigLivePanel's
   * auto-create-the-first-one logic) rely on that distinction. */
  sessions: RigSessionSummary[] | null;
  /** The loader's `rigUnavailableReason` — `null` once resolved and usable,
   * and while still loading (RigLivePanel gates on `sessions === null`
   * first, so this never gets checked before the real value is in). Set,
   * this is reader-facing text explaining why the Rig can't be used here
   * (e.g. a PR-preview environment with no Anthropic key) — RigLivePanel
   * shows it instead of auto-creating a session doomed to fail. */
  unavailableReason: string | null;
  refresh: () => void;
  /** Starts a new Anthropic session via rig-sessions.tsx's action and
   * returns its id — throws on a non-2xx response rather than swallowing
   * it, so a caller mid-transition (RigLivePanel selecting the new session)
   * doesn't silently proceed with nothing to select. */
  createSession: () => Promise<string>;
};

/**
 * The session picker's data source — GET rig-sessions/<workId> to list past
 * sessions, POST to start a new one. Deliberately separate from
 * useRigLiveSession: that hook drives one session's live transcript,
 * this one drives the list a reader chooses *among*.
 */
export function useRigSessions(
  workId: string,
  enabled: boolean,
): UseRigSessionsResult {
  const [sessions, setSessions] = useState<RigSessionSummary[] | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(
    null,
  );
  const url = `/rig-sessions/${workId}`;

  const refresh = useCallback(() => {
    fetch(url)
      .then((response) => {
        if (!response.ok)
          throw new Error(`Couldn't load sessions (${response.status})`);
        return response.json() as Promise<{
          sessions: RigSessionSummary[];
          rigUnavailableReason: string | null;
        }>;
      })
      .then((data) => {
        setSessions(data.sessions);
        setUnavailableReason(data.rigUnavailableReason);
      })
      .catch(() => {
        // Leave whatever was already loaded in place rather than clearing
        // it out from under an open dropdown; a failed background refresh
        // shouldn't make an already-visible list disappear.
      });
  }, [url]);

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

  const createSession = useCallback(async (): Promise<string> => {
    const response = await fetch(url, { method: "POST" });
    if (!response.ok)
      throw new Error(`Couldn't start a new session (${response.status})`);
    const created = (await response.json()) as RigSessionSummary;
    setSessions((prev) => [created, ...(prev ?? [])]);
    return created.id;
  }, [url]);

  return { sessions, unavailableReason, refresh, createSession };
}
