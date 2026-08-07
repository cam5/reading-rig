import { useEffect, useRef, useState } from "react";
import { useRigLiveSession } from "~/rig/useRigLiveSession";
import { useRigSessions } from "~/rig/useRigSessions";
import { RigComposer } from "./RigComposer";
import { RigPanel } from "./RigPanel";
import { RigSessionMenu } from "./RigSessionMenu";
import { RigStatus } from "./RigStatus";
import { RigTranscript } from "./RigTranscript";

type Props = {
  workId: string;
  workTitle: string;
  open: boolean;
  onClose: () => void;
  /** Built by buildRigLaunchContext (title/author + whatever prompted this
   * open — a highlighted excerpt, or the passage currently on screen).
   * `null` when there's nothing to say beyond the reader's own question. */
  context: string | null;
};

const SESSION_URL_PARAM = "rigSession";

function readSessionIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get(SESSION_URL_PARAM);
}

function writeSessionIdToUrl(sessionId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set(SESSION_URL_PARAM, sessionId);
  // Same replaceState-not-navigate convention read.tsx's own ?section=
  // sync already uses: reflects the pick in the address bar (refresh,
  // share, back/forward all land on the same session) without triggering
  // a loader re-run for what's purely client-side panel state.
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

/**
 * Wires RigPanel's chrome to a real session via useRigLiveSession — the one
 * place in this feature that talks to the network, so (like
 * MarginaliaSidebar's HighlightNoteComposer) it has no Storybook story of
 * its own; there's no backend for it to call there.
 *
 * Also owns which of a (user, work)'s several RigSessions is live right
 * now (useRigSessions lists them, RigSessionMenu is the picker) — a
 * concern that didn't exist back when there was only ever one.
 */
export function RigLivePanel({ workId, workTitle, open, onClose, context }: Props) {
  const [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);

  // window.location is only readable client-side — matching the server's
  // `null` on this first client render keeps hydration honest (see
  // issue-83/ssr-hydration-hardening); a real `?rigSession=` value lands a
  // tick later, via this effect, not the initial render.
  useEffect(() => {
    const fromUrl = readSessionIdFromUrl();
    if (fromUrl) setSessionId(fromUrl);
  }, []);

  const { sessions, createSession } = useRigSessions(workId, open);
  const { items, busy, error, send } = useRigLiveSession(workId, sessionId, open);

  function selectSession(id: string) {
    setSessionId(id);
    writeSessionIdToUrl(id);
  }

  const creatingRef = useRef(false);
  async function handleNewSession() {
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      const id = await createSession();
      selectSession(id);
    } catch {
      // Nothing surfaced here on failure — the picker just stays on
      // whatever session was already active, the same silent-retry-later
      // posture a failed `send` already has (see useRigLiveSession).
    } finally {
      creatingRef.current = false;
    }
  }

  // First-ever open of the Rig for this book: nothing in the URL and
  // nothing on record yet. Auto-create rather than making the reader hunt
  // for "New session" before they can say anything — the same silent
  // first-open behavior the Rig always had, now expressed as "create once
  // the list is known to be empty" instead of an implicit DB upsert.
  useEffect(() => {
    if (!open || sessionId || sessions === null) return;
    if (sessions.length > 0) {
      selectSession(sessions[0].id);
    } else {
      void handleNewSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId, sessions]);

  // `context` is only accurate for the moment this open happened — reset
  // the "still needs sending" flag on every fresh open rather than once
  // per session, so a later open with a different excerpt/viewport still
  // gets said, even though the session itself is the same long-lived one.
  const contextPendingRef = useRef(false);
  useEffect(() => {
    if (open) contextPendingRef.current = true;
  }, [open]);

  function handleSend() {
    const text = draft.trim();
    if (!text) return;
    if (contextPendingRef.current && context) {
      send(`${context}\n\n${text}`);
    } else {
      send(text);
    }
    contextPendingRef.current = false;
    setDraft("");
  }

  return (
    <RigPanel
      open={open}
      onClose={onClose}
      title={workTitle}
      headerExtra={
        <RigSessionMenu
          sessions={sessions}
          activeSessionId={sessionId}
          onSelect={selectSession}
          onNewSession={handleNewSession}
        />
      }
    >
      {items.length === 0 && !busy && !error && (
        <p className="text-[13px] opacity-50">Ask about the passage in view, or anything else on your shelf.</p>
      )}
      <RigTranscript items={items} />
      {busy && <RigStatus status="running" />}
      {error && <RigStatus status="error" message={error} />}
      <div className="mt-auto pt-3">
        <RigComposer value={draft} onChange={setDraft} onSend={handleSend} disabled={busy} />
      </div>
    </RigPanel>
  );
}
