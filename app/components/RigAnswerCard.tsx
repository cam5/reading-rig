type Props = {
  /** The posture label ("Interrogate") the turn was asked under — a Rig
   * answer is always asked with one, per the build plan's "the held
   * posture is named in each user message". */
  posture: string;
  body: string;
  /** True while the save-to-margin submission is in flight — the button
   * reads "Saving…" and both actions disable, the same discipline
   * SelectionHighlighter's own Save/Cancel pair doesn't need (that one's
   * a single fetcher tied to one intent; this card sits over a turn that
   * can still be discarded instead). */
  saving?: boolean;
  onSaveToMargin: () => void;
  onDiscard: () => void;
};

/**
 * #29's "last mile": the surface a live Rig answer would render on before
 * it becomes an Entry. Deliberately not EntryCard itself — EntryCard is
 * the *kept* shape (an Entry row, already written), and this ticket's own
 * done-criterion is that saving produces something indistinguishable from
 * a hand entry in EntryCard; a card that already looked like EntryCard
 * before the reader had decided to keep it would blur that distinction.
 * This one is provisional: pushing "Save to margin" is the only thing
 * that turns it into the real thing.
 *
 * Colour follows invariant 1 the same way EntryCard's kicker does —
 * terracotta, since this is always the machine's voice (there is no hand
 * equivalent of a pending answer to save; a hand note is written directly
 * into the margin, no draft step).
 */
export function RigAnswerCard({ posture, body, saving = false, onSaveToMargin, onDiscard }: Props) {
  return (
    <div className="elev-sm rounded-[22px] bg-bg p-4" data-testid="rig-answer-card">
      <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--color-accent-700)]">
        {posture}
      </div>
      <div className="font-reading text-[13.5px] leading-[1.65]">{body}</div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="btn btn-primary text-[12px]"
          disabled={saving}
          onClick={onSaveToMargin}
        >
          {saving ? "Saving…" : "↩ Save to margin"}
        </button>
        <button type="button" className="btn btn-ghost text-[12px]" disabled={saving} onClick={onDiscard}>
          Discard
        </button>
      </div>
    </div>
  );
}
