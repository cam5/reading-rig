import { useEffect, useState } from "react";

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

/** Always called, `active` or not — RigStatus can't gate a hook behind
 * `status === "running"` without breaking rules-of-hooks, so the interval
 * itself is the thing that no-ops while inactive. Resets to the first verb
 * whenever `active` flips, so the very next run starts the sequence fresh
 * rather than resuming mid-rotation from whatever's left over from before. */
function useRunningVerb(active: boolean): string {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setIndex(0);
      return;
    }
    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % RUNNING_VERBS.length);
    }, RUNNING_VERB_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active]);

  return RUNNING_VERBS[index];
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
  const colorClass =
    status === "error"
      ? "text-[var(--color-accent-800)]"
      : "text-text opacity-50";
  const text = status === "running" ? `${runningVerb}…` : statusText[status];

  return (
    <div
      className={[
        "flex items-center gap-2 py-1.5 text-[11.5px]",
        colorClass,
      ].join(" ")}
    >
      {status === "running" && (
        <span className="h-[6px] w-[6px] flex-none animate-pulse rounded-full bg-[var(--color-accent)]" />
      )}
      <span>{text}</span>
      {message && <span className="text-text opacity-50">— {message}</span>}
    </div>
  );
}
