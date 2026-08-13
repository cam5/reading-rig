import { useEffect, useRef, useState } from "react";
import { sendAnalyticsBeacon } from "~/analyticsBeacon";
import type { OnScreenExcerpt } from "~/domain/paragraph/onScreenExcerpt";
import { useRigLiveSession } from "~/rig/useRigLiveSession";
import { useRigSessions } from "~/rig/useRigSessions";
import { RigPanel } from "./RigPanel";
import { RigSessionMenu } from "./RigSessionMenu";
import { RigStatus } from "./RigStatus";
import { RigTranscript } from "./RigTranscript";
import { TokenComposer } from "./TokenComposer";

type Props = {
  workId: string;
  workTitle: string;
  open: boolean;
  onClose: () => void;
  /** Built by buildRigLaunchContext (title/author + whatever prompted this
   * open — a highlighted excerpt, or the passage currently on screen).
   * `null` when there's nothing to say beyond the reader's own question. */
  context: string | null;
  /** read.tsx's live "in view" range — threaded straight through to
   * TokenComposer for its pinned suggestion (#117 follow-up). Distinct from
   * `context` above: that's a one-shot string sent automatically with the
   * first message after open, this is a token the reader can insert
   * explicitly, any time, more than once across a session. */
  onScreenExcerpt: OnScreenExcerpt | null;
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
export function RigLivePanel({ workId, workTitle, open, onClose, context, onScreenExcerpt }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);

  // window.location is only readable client-side — matching the server's
  // `null` on this first client render keeps hydration honest (see
  // issue-83/ssr-hydration-hardening); a real `?rigSession=` value lands a
  // tick later, via this effect, not the initial render.
  useEffect(() => {
    const fromUrl = readSessionIdFromUrl();
    if (fromUrl) setSessionId(fromUrl);
  }, []);

  const { sessions, unavailableReason, createSession } = useRigSessions(workId, open);
  const { items, busy, error, send } = useRigLiveSession(workId, sessionId, open);

  function selectSession(id: string) {
    setSessionId(id);
    writeSessionIdToUrl(id);
  }

  // The only one of selectSession's three callers that means "the reader
  // chose this": the panel's own first-open auto-select and
  // handleNewSession's post-create select both call selectSession
  // directly, not this, since neither is a switch away from something the
  // reader was already looking at (see rig_session_switched's doc comment
  // in app/analytics.server.ts). Guarded against re-picking the session
  // that's already active — RigSessionMenu still renders it as an option
  // (with a checkmark), and clicking it again is a no-op, not a switch.
  function handleSelectFromMenu(id: string) {
    if (id === sessionId) return;
    selectSession(id);
    sendAnalyticsBeacon({ name: "rig_session_switched", workId, sessionCount: sessions?.length ?? 0 });
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
  // Skipped entirely when unavailableReason is set — an environment with
  // no Anthropic key configured (PR previews) would just 503 on this, and
  // the reason is already shown below instead.
  useEffect(() => {
    if (!open || sessionId || sessions === null || unavailableReason) return;
    if (sessions.length > 0) {
      selectSession(sessions[0].id);
    } else {
      void handleNewSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId, sessions, unavailableReason]);

  // `context` is only accurate for the moment this open happened — reset
  // the "still needs sending" flag on every fresh open rather than once
  // per session, so a later open with a different excerpt/viewport still
  // gets said, even though the session itself is the same long-lived one.
  const contextPendingRef = useRef(false);
  useEffect(() => {
    if (open) contextPendingRef.current = true;
  }, [open]);

  // `text` arrives already serialized and trimmed from TokenComposer, which
  // owns its own content — mention pills have to become quoted passages
  // before anything up here can prepend to them.
  function handleSend(text: string) {
    if (!text) return;
    if (contextPendingRef.current && context) {
      send(`${context}\n\n${text}`);
    } else {
      send(text);
    }
    contextPendingRef.current = false;
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
          onSelect={handleSelectFromMenu}
          onNewSession={handleNewSession}
          newSessionDisabled={Boolean(unavailableReason)}
        />
      }
      footer={
        <TokenComposer
          workId={workId}
          onSend={handleSend}
          onScreenExcerpt={onScreenExcerpt}
          disabled={busy || Boolean(unavailableReason)}
        />
      }
    >
      {unavailableReason ? (
        <p className="text-[13px] opacity-50">{unavailableReason}</p>
      ) : (
        <>
          {items.length === 0 && !busy && !error && (
            <p className="text-[13px] opacity-50">Ask about the passage in view, or anything else on your shelf.</p>
          )}
          <RigTranscript items={items} />
          {busy && <RigStatus status="running" />}
          {error && <RigStatus status="error" message={error} />}
        </>
      )}
    </RigPanel>
  );
}
