import { useEffect, useState } from "react";
import styles from "./RigStatus.module.css";

type Status = "running" | "idle" | "terminated" | "error";

type Props = {
  /** "running" is driven live only — RigLivePanel passes it straight off
   * `useRigLiveSession`'s `busy`, pinned below the transcript, never
   * backfilled from history (see toTranscriptItems.ts's `status` variant
   * doc comment for why). "idle"/"terminated" map to their like-named
   * `session.status_*` events; "error" to a `session.error` event (see
   * `BetaManagedAgentsSessionErrorEvent` — one of several typed error
   * shapes, all sharing `message` and a `retry_status`). "idle" is
   * deliberately not shown by default — a session going idle after
   * `end_turn` is the normal, silent outcome; a caller only needs this
   * component for the other three. */
  status: Status;
  /** `session.error`'s `error.message`, or a `retry_status`-derived note
   * ("retrying…" / "retries exhausted"). Required when status is "error". */
  message?: string;
};

const statusText: Record<Exclude<Status, "running">, string> = {
  idle: "Idle",
  terminated: "Session ended",
  error: "Something went wrong",
};

/** Cycled through, one at a time, for as long as `status === "running"` —
 * the Claude.ai/ChatGPT "[Verb]ing…" pattern, swapped in here in place of
 * the old static "The Rig is working" line per PR #152's review: a single
 * word sitting still for a 30s+ tool-use round trip reads as stalled, a
 * slowly rotating one reads as alive. Order doesn't matter — there's no
 * real signal yet for which verb matches what the Rig is actually doing
 * (see `agent.thinking`'s own lack of content, `RigThinking`'s doc
 * comment) — this is texture, not a status report. */
const RUNNING_VERBS = [
  "Thinking",
  "Reading",
  "Working through it",
  "Considering",
  "Piecing it together",
  "Riddling you this",
  "Stroking digital beard",
  "Contemplating",
  "Showering",
  "Making a tea",
  "Awaiting the muse",
];

const RUNNING_VERB_INTERVAL_MS = 2200;

function shuffledVerbs(): string[] {
  const verbs = [...RUNNING_VERBS];
  for (let i = verbs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [verbs[i], verbs[j]] = [verbs[j], verbs[i]];
  }
  return verbs;
}

/** Always called, `active` or not — RigStatus can't gate a hook behind
 * `status === "running"` without breaking rules-of-hooks, so the interval
 * itself is the thing that no-ops while inactive. Reshuffles and resets to
 * the first verb whenever `active` flips on, so each run starts the
 * sequence fresh with its own order rather than resuming mid-rotation or
 * repeating the same order every time. */
function useRunningVerb(active: boolean): string {
  const [index, setIndex] = useState(0);
  const [verbs, setVerbs] = useState(RUNNING_VERBS);

  useEffect(() => {
    if (!active) {
      setIndex(0);
      return;
    }
    setVerbs(shuffledVerbs());
    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % RUNNING_VERBS.length);
    }, RUNNING_VERB_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active]);

  return verbs[index];
}

/**
 * There is no dedicated "danger" color in Organic's palette (warmth-only by
 * design, per the readme's "Don't desaturate into greys") — errors use the
 * deepest step of the accent ramp rather than a red that doesn't exist in
 * this system. Worth a second look in a design-refinement pass: an
 * accent-toned error reads as "the Rig itself, urgently" rather than "a
 * system error," which may or may not be the intent.
 */
export function RigStatus({ status, message }: Props) {
  const runningVerb = useRunningVerb(status === "running");
  const colorClass = status === "error" ? styles.error : styles.muted;
  const text = status === "running" ? `${runningVerb}…` : statusText[status];

  return (
    <div
      className={[
        "flex items-center gap-2 py-1.5",
        styles.text,
        colorClass,
      ].join(" ")}
    >
      {status === "running" && (
        <span className={["flex-none animate-pulse", styles.dot].join(" ")} />
      )}
      <span>{text}</span>
      {message && <span className={styles.muted}>— {message}</span>}
    </div>
  );
}
