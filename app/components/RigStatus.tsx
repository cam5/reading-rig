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
 * Errors use `--color-danger`, Bop's dedicated third role — Organic had no
 * real red in its warmth-only palette, so this state used to borrow the
 * deepest accent step and read as "the Rig itself, urgently" rather than
 * "a system error." Bop's palette isn't warmth-only, so this is a real
 * answer rather than a workaround.
 */
export function RigStatus({ status, message }: Props) {
  const colorClass =
    status === "error" ? "text-[var(--color-danger-700)]" : "text-[color-mix(in_srgb,var(--color-text)_50%,transparent)]";

  return (
    <div className={["flex items-center gap-2 py-1.5 text-[11.5px]", colorClass].join(" ")}>
      {status === "running" && (
        <span className="h-[6px] w-[6px] flex-none animate-pulse rounded-full bg-[var(--color-accent)]" />
      )}
      <span>{statusText[status]}</span>
      {message && <span className="text-[color-mix(in_srgb,var(--color-text)_50%,transparent)]">— {message}</span>}
    </div>
  );
}
