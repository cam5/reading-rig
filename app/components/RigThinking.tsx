type Props = {
  /** Shown only while still live (`durationMs` undefined) — there's still
   * nothing else to show *during* a thinking beat: `agent.thinking` carries
   * no content of its own, the SDK's own doc comment calls it "a progress
   * signal, not a content carrier" (events.d.ts), confirmed against a real
   * capture (see app/rig/__fixtures__/referenceSessionEvents.ts's
   * `toolUseTurnEvents`, which has two `agent.thinking` events, both bare
   * `{id, processed_at, type}`). What *is* usable is timing — every event
   * carries `processed_at`, so toTranscriptItems.ts can measure how long a
   * beat lasted even though it can't say what it was about. See
   * `durationMs` below. */
  label?: string;
  /** Milliseconds between this beat's own `agent.thinking` event and
   * whatever event followed it (see toTranscriptItems.ts's `openThinking`
   * handling) — undefined while this beat is still the most recent event in
   * the transcript, i.e. still actually in progress. Once set, this stops
   * pulsing and collapses to a static "Thought for …" line instead, the way
   * Claude.ai/ChatGPT resolve their own thinking indicators. */
  durationMs?: number;
};

/** Under a second reads as "0s", which looks like a bug, not a fast
 * answer — round up to a vaguer "a moment" instead. Otherwise: bare seconds
 * under a minute, "Nm Ss" past it (minutes with no seconds omits the "0s"
 * remainder rather than reading "1m 0s"). */
function formatThinkingDuration(durationMs: number): string {
  if (durationMs < 1000) return "Thought for a moment";
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) return `Thought for ${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0
    ? `Thought for ${minutes}m ${seconds}s`
    : `Thought for ${minutes}m`;
}

/**
 * A pulse while live, a resolved duration once closed — see the SDK's own
 * framing of `agent.thinking` in the Props comment above for why there's
 * never more than that to show. Reads the same low-emphasis way as
 * `RigToolUsage`, since like tool activity it's the Rig's process rather
 * than something it's saying to the reader.
 */
export function RigThinking({ label = "Thinking…", durationMs }: Props) {
  if (durationMs !== undefined) {
    return (
      <div className="py-1 text-[11.5px] italic text-text opacity-45">
        {formatThinkingDuration(durationMs)}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 py-1 text-[11.5px] italic text-text opacity-45">
      <span className="flex gap-[3px]">
        <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-current [animation-delay:0ms]" />
        <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-current [animation-delay:150ms]" />
        <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-current [animation-delay:300ms]" />
      </span>
      {label}
    </div>
  );
}
