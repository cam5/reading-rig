import { useEffect, useRef, useState } from "react";
import { sendAnalyticsBeacon } from "~/analyticsBeacon";
import type { OnScreenExcerpt } from "~/domain/paragraph/onScreenExcerpt";
import { useRigLiveSession } from "~/rig/useRigLiveSession";
import { useRigSessions } from "~/rig/useRigSessions";
import { RigPanel } from "./RigPanel";
import { RigSessionMenu } from "./RigSessionMenu";
import { RigStatus } from "./RigStatus";
import { RigTranscript } from "./RigTranscript";
import { TokenComposer, type PillSeed } from "./TokenComposer";
import { useStickToBottom } from "./useStickToBottom";
import styles from "./RigLivePanel.module.css";

type Props = {
  workId: string;
  workTitle: string;
  open: boolean;
  onClose: () => void;
  /** Built by buildRigLaunchContext (title/author + the passage currently on
   * screen, for the header's context-free "Ask the Rig"). `null` when
   * there's nothing to say beyond the reader's own question. */
  context: string | null;
  /** read.tsx's live "in view" range — threaded straight through to
   * TokenComposer for its pinned suggestion (#117 follow-up). Distinct from
   * `context` above: that's a one-shot string sent automatically with the
   * first message after open, this is a token the reader can insert
   * explicitly, any time, more than once across a session. */
  onScreenExcerpt: OnScreenExcerpt | null;
  /** A highlighted selection's "Ask the Rig" click, as a pill to seed
   * TokenComposer with — threaded straight through, RigLivePanel has no
   * reason to touch it itself. `null` when nothing's pending (the header's
   * context-free open, or no open has happened yet). */
  seedPill: PillSeed | null;
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
export function RigLivePanel({
  workId,
  workTitle,
  open,
  onClose,
  context,
  onScreenExcerpt,
  seedPill,
}: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  // A failed handleNewSession, surfaced the same way useRigLiveSession
  // surfaces a failed send/SSE drop — but deliberately not folded into
  // that hook's own `error`: this can be true *before* any session
  // exists to hand useRigLiveSession, and needs to survive independently
  // of whichever session ends up selected (or doesn't).
  const [sessionError, setSessionError] = useState<string | null>(null);

  // window.location is only readable client-side — matching the server's
  // `null` on this first client render keeps hydration honest (see
  // issue-83/ssr-hydration-hardening); a real `?rigSession=` value lands a
  // tick later, via this effect, not the initial render.
  useEffect(() => {
    const fromUrl = readSessionIdFromUrl();
    if (fromUrl) setSessionId(fromUrl);
  }, []);

  const { sessions, unavailableReason, createSession } = useRigSessions(
    workId,
    open,
  );
  const { items, busy, error, send } = useRigLiveSession(
    workId,
    sessionId,
    open,
  );

  // Keeps the transcript pinned to its bottom edge as content grows,
  // unless the reader has scrolled up to reread something — see
  // useStickToBottom's own doc comment for why this watches the DOM
  // itself rather than keying off `items`/`busy`.
  const { ref: transcriptRef, scrollToBottom } =
    useStickToBottom<HTMLDivElement>();

  function selectSession(id: string) {
    setSessionId(id);
    writeSessionIdToUrl(id);
    // Any successful selection — a fresh session, an existing one from the
    // menu, or the auto-picked most-recent one on open — means whatever
    // handleNewSession failure (if any) led here is no longer the live
    // story; stale error text shouldn't linger under a working session.
    setSessionError(null);
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
    sendAnalyticsBeacon({
      name: "rig_session_switched",
      workId,
      sessionCount: sessions?.length ?? 0,
    });
  }

  const creatingRef = useRef(false);
  // Mirrors creatingRef for rendering — the ref alone is enough to guard
  // against a re-entrant call (effect + click racing each other), but a
  // ref update doesn't trigger a re-render, and RigSessionMenu needs to
  // know "an attempt is in flight" to show it.
  const [creatingSession, setCreatingSession] = useState(false);
  async function handleNewSession() {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreatingSession(true);
    // Cleared up front, not just in the catch below, so a retry after a
    // previous failure doesn't keep showing the stale error while this
    // attempt is still in flight — the same posture useRigLiveSession's
    // `send` takes with its own `error` before it POSTs.
    setSessionError(null);
    try {
      const id = await createSession();
      selectSession(id);
    } catch {
      // Surfaced via the same RigStatus/error pattern `send` and the SSE
      // connection already use below — previously this catch block did
      // nothing, so a failed click (or a failed auto-create on first
      // open) had no visible effect at all.
      setSessionError("Couldn't start a new session — try again.");
    } finally {
      creatingRef.current = false;
      setCreatingSession(false);
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
    // A reader who scrolled up to reread something, then sends a new
    // message, means to jump back into the live conversation — re-pin and
    // jump immediately rather than waiting on the next streamed item.
    scrollToBottom();
  }

  return (
    <RigPanel
      open={open}
      onClose={onClose}
      title={workTitle}
      scrollContainerRef={transcriptRef}
      headerExtra={
        <RigSessionMenu
          sessions={sessions}
          activeSessionId={sessionId}
          onSelect={handleSelectFromMenu}
          onNewSession={handleNewSession}
          newSessionDisabled={Boolean(unavailableReason)}
          creatingSession={creatingSession}
        />
      }
      footer={
        <TokenComposer
          workId={workId}
          onSend={handleSend}
          onScreenExcerpt={onScreenExcerpt}
          seedPill={seedPill}
          disabled={busy || Boolean(unavailableReason)}
        />
      }
    >
      {unavailableReason ? (
        <p className={styles.empty}>{unavailableReason}</p>
      ) : (
        <>
          {/* Can be true with no session selected at all (a failed
           * auto-create on first open), so this is checked ahead of — and
           * takes precedence over — the empty-state hint below, the same
           * way `error` already takes precedence-adjacent to `busy`. */}
          {sessionError && <RigStatus status="error" message={sessionError} />}
          {items.length === 0 && !busy && !error && !sessionError && (
            <p className={styles.empty}>
              Ask about the passage in view, or anything else on your shelf.
            </p>
          )}
          <RigTranscript items={items} />
          {busy && <RigStatus status="running" />}
          {error && <RigStatus status="error" message={error} />}
        </>
      )}
    </RigPanel>
  );
}
