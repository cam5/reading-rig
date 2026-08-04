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
 * A connection here means "watch until caught up," not "stay attached to
 * the session": rig.tsx's loader closes the response once backfill reaches
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
