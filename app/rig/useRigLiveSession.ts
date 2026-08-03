import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toTranscriptItems, type RigDisplayEvent, type TranscriptItem } from "./toTranscriptItems";

type UseRigLiveSessionResult = {
  items: TranscriptItem[];
  busy: boolean;
  error: string | null;
  send: (text: string) => void;
};

/**
 * The browser half of rig.tsx's session-lifecycle route — opens an
 * EventSource against its GET (SSE) side, POSTs into its action side to
 * send a message, and folds the resulting events through
 * `toTranscriptItems` for display.
 *
 * The GET side is not one long-lived connection: rig.tsx's loader runs the
 * session loop until it's genuinely caught up (backfill reaches the true
 * end of history, or the live tail goes idle) and then closes the
 * response itself — see sessionLoop.ts's own note on why a resumed
 * session's backfill has to scan *all* of history rather than stopping at
 * the first idle-terminal boundary it crosses, now that a session can hold
 * several already-finished turns. This hook has to honor that same
 * distinction: an idle-terminal event arriving mid-stream is a turn
 * *boundary*, not "nothing left to read" — closing the connection there
 * (an earlier version of this hook did exactly that) truncates the view to
 * whichever turn happened to end first, exactly the bug just fixed
 * server-side. So this only ever closes in response to the connection
 * itself actually ending (`onerror`, which fires whether that's a graceful
 * server close or a real transport drop — see the note below), never on
 * a single event's contents.
 *
 * A connection here is "watch until caught up," not "stay attached to the
 * session" — this hook reopens one on every `send` rather than holding one
 * open across idle stretches.
 *
 * Known gap: a genuine transport drop and a graceful server close both
 * surface as the same `onerror`, so both are treated as "stop, and let the
 * next `send` reconnect" rather than retried automatically — acceptable
 * for a local dev tool, worth revisiting before this is load-bearing
 * anywhere less forgiving.
 */
export function useRigLiveSession(workId: string, enabled: boolean): UseRigLiveSessionResult {
  const [events, setEvents] = useState<RigDisplayEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const url = `/rig/${workId}`;

  const closeSource = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setBusy(false);
  }, []);

  const connect = useCallback(() => {
    if (sourceRef.current) return;
    setError(null);
    setBusy(true);
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
          setError((JSON.parse(data) as { message?: string }).message ?? "Something went wrong.");
        } catch {
          setError("Something went wrong.");
        }
      }
      closeSource();
    };
  }, [url, closeSource]);

  useEffect(() => {
    if (enabled) connect();
    return () => closeSource();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, workId]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // Connect only *after* the POST resolves, not before: rig.tsx's GET
      // closes itself the moment its history backfill finds nothing to do
      // (see the module doc comment above), which — opened too early — can
      // win the race against our own POST still being in flight and close
      // right back down having seen nothing new. Awaiting the response
      // first guarantees the message has actually reached the session
      // (this app's own action() has already called Anthropic's
      // `events.send`) before the GET's backfill runs, so it always has
      // something to find.
      setBusy(true);
      setError(null);
      const formData = new FormData();
      formData.set("message", trimmed);
      fetch(url, { method: "POST", body: formData })
        .then((response) => {
          if (!response.ok) throw new Error(`Send failed (${response.status})`);
          connect();
        })
        .catch(() => {
          setBusy(false);
          setError("Couldn't send — try again.");
        });
    },
    [url, connect],
  );

  const items = useMemo(() => toTranscriptItems(events), [events]);

  return { items, busy, error, send };
}
