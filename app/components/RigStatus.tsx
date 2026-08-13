type Status = "running" | "idle" | "terminated" | "error";

type Props = {
  /** Maps to `session.status_running` / `_idle` / `_terminated`, or a
   * `session.error` event (see `BetaManagedAgentsSessionErrorEvent` —
   * one of several typed error shapes, all sharing `message` and a
   * `retry_status`). "idle" is deliberately not shown by default — a
   * session going idle after `end_turn` is the normal, silent outcome; a
   * caller only needs this component for the other three. */
  status: Status;
  /** `session.error`'s `error.message`, or a `retry_status`-derived note
   * ("retrying…" / "retries exhausted"). Required when status is "error". */
  message?: string;
};

const statusText: Record<Status, string> = {
  running: "The Rig is working",
  idle: "Idle",
  terminated: "Session ended",
  error: "Something went wrong",
};

/**
 * There is no dedicated "danger" color in Organic's palette (warmth-only by
 * design, per the readme's "Don't desaturate into greys") — errors use the
 * deepest step of the accent ramp rather than a red that doesn't exist in
 * this system. Worth a second look in a design-refinement pass: an
 * accent-toned error reads as "the Rig itself, urgently" rather than "a
 * system error," which may or may not be the intent.
 */
export function RigStatus({ status, message }: Props) {
  const colorClass =
    status === "error"
      ? "text-[var(--color-accent-800)]"
      : "text-text opacity-50";

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
      <span>{statusText[status]}</span>
      {message && <span className="text-text opacity-50">— {message}</span>}
    </div>
  );
}
