type Props = {
  /** "agent" maps to `agent.message`, "user" to `user.message` — see
   * events.d.ts's `BetaManagedAgentsAgentMessageEvent` / `...UserMessageEvent`.
   * Named `role`, not `origin` like EntryCard: this is the live exchange
   * itself, before anything is (or isn't) pushed into the margin — origin
   * is EntryCard's vocabulary for what's already been kept. */
  role: "user" | "agent";
  /** Joined text from the event's `content` array. The real API sends an
   * array of blocks (text, and for user messages potentially image/document
   * too); joining to one string here keeps this component's contract
   * simple and pushes multi-block handling to the call site, which already
   * has to look at `content[].type` to decide what to render anyway. */
  text: string;
  /** True while an `event_delta` preview is still arriving for this
   * message's id (see `EventStreamParams.event_deltas` — `agent.message`
   * previews stream `content_delta` fragments before the buffered event
   * lands). Shows a soft trailing cursor rather than a spinner, since by
   * the time this is true there's already real text to read. */
  streaming?: boolean;
};

/**
 * A turn of the live conversation — not a saved note (that's EntryCard) and
 * deliberately not a chat bubble: the design direction for this pane ruled
 * bubbles out explicitly ("make 1c the main direction and drop the chat
 * bubbles"). No fill, no corners — just a quiet kicker and the text,
 * reading as part of the same notebook page as everything else in 1c's
 * right pane.
 */
export function RigMessage({ role, text, streaming = false }: Props) {
  const kickerLabel = role === "agent" ? "Rig" : "You";
  const kickerColorClass = role === "agent" ? "text-[var(--color-accent-700)]" : "text-[var(--color-accent-2-700)]";

  return (
    <div className="py-2">
      <div className={["mb-1.5 text-[10px] uppercase tracking-wide", kickerColorClass].join(" ")}>{kickerLabel}</div>
      <div className="font-reading text-[16px] leading-[1.6] whitespace-pre-wrap">
        {text}
        {streaming && <span className="ml-0.5 inline-block w-[0.5em] animate-pulse text-[var(--color-accent)]">▊</span>}
      </div>
    </div>
  );
}
