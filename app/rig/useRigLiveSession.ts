import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  joinText,
  toTranscriptItems,
  type RigDisplayEvent,
  type TranscriptItem,
} from "./toTranscriptItems";

type UseRigLiveSessionResult = {
  items: TranscriptItem[];
  busy: boolean;
  error: string | null;
  send: (text: string) => void;
};

/** A non-2xx from `send`'s POST. Carries the status so the catch below can
 * tell the reader what to do next — a missing session, a signed-out reader
 * and an unavailable Rig all need different advice, and "try again" is only
 * right for some of them. `reason` is the server's own reader-facing
 * explanation when it sent one (see `readerFacingReason`). */
export class SendFailedError extends Error {
  readonly status: number;
  readonly reason: string | null;

  constructor(status: number, reason: string | null = null) {
    super(`Send failed (${status})`);
    this.name = "SendFailedError";
    this.status = status;
    this.reason = reason;
  }
}

const MAX_READER_FACING_REASON_LENGTH = 200;

// Only a 503 from this app's own action carries text written for a reader
// (anthropicSessionClient.ts's `rigUnavailableReason`) — its other error
// bodies are developer-facing, and a 503 from a proxy in front of the app
// would be an HTML page. Short text/plain is the tell.
async function readerFacingReason(response: Response): Promise<string | null> {
  if (response.status !== 503) return null;
  if (!response.headers.get("Content-Type")?.startsWith("text/plain")) {
    return null;
  }
  const text = (await response.text()).trim();
  return text && text.length <= MAX_READER_FACING_REASON_LENGTH ? text : null;
}

// Exported for its test — the reader copy for a failed `send`. Anything
// that isn't a SendFailedError (a network drop, an aborted fetch) and any
// status without specific advice falls through to the generic line.
export function sendErrorMessage(error: unknown): string {
  if (!(error instanceof SendFailedError)) return "Couldn't send — try again.";
  switch (error.status) {
    case 404:
      return "This session is no longer available — start a new one to keep going.";
    case 401:
      return "You've been signed out — reload and sign in again.";
    case 429:
      return "The Rig is busy right now — try again in a moment.";
    case 503:
      return (
        error.reason ??
        "The Rig isn't available right now — try again in a moment."
      );
    default:
      return "Couldn't send — try again.";
  }
}

/**
 * The browser half of api.v1.rig.tsx's session-lifecycle route — opens an
 * EventSource against its GET (SSE) side, POSTs into its action side to
 * send a message, and folds the resulting events through
 * `toTranscriptItems` for display.
 *
 * `sessionId` names which RigSession to talk to (api.v1.rig.tsx's `?session=`) —
 * `null` means "no session chosen yet," and this hook simply doesn't
 * connect until the caller (RigLivePanel, once useRigSessions resolves an
 * active or freshly created session) supplies one. Switching to a
 * different id tears down the old connection and its accumulated
 * transcript and starts over against the new session — two sessions'
 * events are never merged into one transcript.
 *
 * A connection here means "watch until caught up," not "stay attached to
 * the session": api.v1.rig.tsx's loader closes the response once backfill reaches
 * the end of history or the live tail goes idle, and this hook reopens a
 * fresh one on every `send` rather than holding one open across idle
 * stretches.
 *
 * An idle-terminal event mid-stream is a turn *boundary*, not "nothing
 * left to read" — a resumed session can hold several already-finished
 * turns (see sessionLoop.ts), so this only closes in response to the
 * connection itself ending (`onerror`), never on a single event's
 * contents.
 *
 * Known gap: `onerror` fires the same way for a genuine transport drop and
 * a graceful server close, so both just stop and wait for the next `send`
 * to reconnect rather than retrying automatically — fine for a local dev
 * tool, worth revisiting before this is load-bearing anywhere less
 * forgiving.
 */
export function useRigLiveSession(
  workId: string,
  sessionId: string | null,
  enabled: boolean,
): UseRigLiveSessionResult {
  const [events, setEvents] = useState<RigDisplayEvent[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The message `send` just POSTed, shown as a dimmed transcript item until
  // its own `user.message` SSE echo lands in `events` — otherwise the
  // reader's just-submitted text vanishes from the composer (TokenComposer
  // clears itself synchronously on submit) and nothing takes its place
  // until the POST resolves, the GET reconnects, and backfill replays it.
  // `null` once there's nothing pending: either nothing's been sent yet, or
  // the echo already arrived (see the effect below) or the send failed.
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const url = sessionId ? `/api/v1/rig/${workId}?session=${sessionId}` : null;

  const closeSource = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const connect = useCallback(() => {
    if (!url || sourceRef.current) return;
    setError(null);
    const source = new EventSource(url);
    sourceRef.current = source;

    source.onmessage = (message: MessageEvent<string>) => {
      let event: RigDisplayEvent;
      try {
        event = JSON.parse(message.data) as RigDisplayEvent;
      } catch {
        return;
      }
      // event_start/event_delta preview frames (see anthropicSessionSource.ts's
      // event_deltas opt-in) carry no top-level `id` — it lives nested, as
      // `event.event.id` / `event.event_id` — and per the SDK never appears
      // in event history, so a reconnect's backfill can't replay one. Both
      // facts mean the id-dedupe below doesn't apply to them: skip it and
      // always append, rather than treating every frame after the first
      // `undefined` as a duplicate.
      if (event.type === "event_start" || event.type === "event_delta") {
        setEvents((prev) => [...prev, event]);
        return;
      }
      if (!seenIds.current.has(event.id)) {
        seenIds.current.add(event.id);
        setEvents((prev) => [...prev, event]);
      }
    };

    // The route's application-level error frames are sent as
    // `event: error`, which the DOM dispatches through `onerror` as a
    // MessageEvent with `.data` — the same handler a raw transport failure
    // fires, as a plain Event with none. That `.data` check is the only
    // way to tell the two apart.
    source.onerror = (event) => {
      const data = (event as MessageEvent<string>).data;
      if (typeof data === "string") {
        try {
          setError(
            (JSON.parse(data) as { message?: string }).message ??
              "Something went wrong.",
          );
        } catch {
          setError("Something went wrong.");
        }
      }
      closeSource();
    };
  }, [url, closeSource]);

  useEffect(() => {
    // A session switch (including from "none yet" to a real id) starts a
    // clean transcript — a stale event from the previous session replaying
    // into the new one would misattribute a turn to the wrong conversation.
    setEvents([]);
    seenIds.current = new Set();
    setError(null);
    setPendingMessage(null);
    if (enabled) connect();
    return () => closeSource();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, url]);

  // Once the real `user.message` this hook is waiting on shows up in
  // `events` (via backfill after `connect()` reopens the GET), the
  // optimistic stand-in has nothing left to do — drop it so the two don't
  // ever render side by side. Compares against the exact same `trimmed`
  // string `send` both POSTed and stashed as `pendingMessage`, which
  // api.v1.rig.tsx's action echoes back as the event's own content — modulo line
  // endings: `formData.set` below runs `trimmed` through the FormData spec's
  // newline-normalization algorithm, turning every bare `\n` into `\r\n`
  // before it ever reaches the server, so a context-prefixed message (whose
  // `\n\n` join is what makes the "Reading context" pill possible) always
  // echoes back with different line endings than `pendingMessage` kept.
  // Normalizing both sides makes the comparison exact-text-content again
  // rather than exact-bytes.
  useEffect(() => {
    if (!pendingMessage) return;
    const normalize = (text: string) => text.replace(/\r\n/g, "\n");
    const echoed = events.some(
      (event) =>
        event.type === "user.message" &&
        normalize(joinText(event.content)) === normalize(pendingMessage),
    );
    if (echoed) setPendingMessage(null);
  }, [events, pendingMessage]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !url) return;
      // Shown immediately, ahead of any network round trip — see
      // `pendingMessage`'s own doc comment above for why.
      setPendingMessage(trimmed);
      // Connect only *after* the POST resolves, not before: api.v1.rig.tsx's GET
      // closes itself the moment its history backfill finds nothing to do
      // (see the module doc comment above), which — opened too early — can
      // win the race against our own POST still being in flight and close
      // right back down having seen nothing new. Awaiting the response
      // first guarantees the message has actually reached the session
      // (this app's own action() has already called Anthropic's
      // `events.send`) before the GET's backfill runs, so it always has
      // something to find.
      setSending(true);
      setError(null);
      const formData = new FormData();
      formData.set("message", trimmed);
      fetch(url, { method: "POST", body: formData })
        .then(async (response) => {
          if (!response.ok) {
            throw new SendFailedError(
              response.status,
              await readerFacingReason(response),
            );
          }
          connect();
        })
        .catch((error: unknown) => {
          setError(sendErrorMessage(error));
          setPendingMessage(null);
        })
        .finally(() => setSending(false));
    },
    [url, connect],
  );

  const items = useMemo(() => {
    const base = toTranscriptItems(events);
    if (pendingMessage) {
      base.push({
        kind: "message",
        id: "pending-message",
        role: "user",
        text: pendingMessage,
        pending: true,
      });
    }
    return base;
  }, [events, pendingMessage]);

  // The last-seen top-level session status, not the connection's own
  // open/closed state — see the module doc comment above.
  const agentRunning = useMemo(() => {
    let running = false;
    for (const event of events) {
      if (event.type === "session.status_running") running = true;
      else if (
        event.type === "session.status_idle" ||
        event.type === "session.status_terminated"
      )
        running = false;
    }
    return running;
  }, [events]);

  return { items, busy: sending || agentRunning, error, send };
}
