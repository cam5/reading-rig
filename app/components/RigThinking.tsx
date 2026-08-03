type Props = {
  /** There is nothing else to show here: `agent.thinking` carries no
   * content of its own — the SDK's own doc comment calls it "a progress
   * signal, not a content carrier" (events.d.ts), confirmed against a real
   * capture (see app/rig/__fixtures__/referenceSessionEvents.ts's
   * `toolUseTurnEvents`, which has two `agent.thinking` events, both bare
   * `{id, processed_at, type}`). Don't add a `text`/`summary` prop later
   * without re-checking that against a real one — there's no field to put
   * it in. */
  label?: string;
};

/**
 * A pulse, not a thought bubble — see the SDK's own framing of
 * `agent.thinking` in the Props comment above. Reads the same low-emphasis
 * way as `RigToolUsage`, since like tool activity it's the Rig's process
 * rather than something it's saying to the reader.
 */
export function RigThinking({ label = "Thinking…" }: Props) {
  return (
    <div className="flex items-center gap-2 py-1 text-[11.5px] italic text-[rgba(32,30,29,.45)]">
      <span className="flex gap-[3px]">
        <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-current [animation-delay:0ms]" />
        <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-current [animation-delay:150ms]" />
        <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-current [animation-delay:300ms]" />
      </span>
      {label}
    </div>
  );
}
