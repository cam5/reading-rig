import styles from "./RigAnchorMarker.module.css";

type Props = {
  /** Every RigSession pegged to this paragraph's globalOrdinal — see
   * read.tsx's rigSessionsByAnchorOrdinal. Always 1+; a caller with none
   * doesn't render this component at all. */
  sessions: { id: string }[];
  onSelect: (sessionId: string) => void;
};

/**
 * The reading column's right-margin marker: one small speech-bubble button
 * per RigSession anchored to the paragraph it's rendered against (see
 * ReadingParagraph's `marginContent`), stacked top to bottom when a
 * paragraph has more than one. Purely a click target — the transcript
 * itself only ever shows in RigLivePanel, opened via `onSelect`
 * (read.tsx's handleOpenRigSession).
 */
export function RigAnchorMarker({ sessions, onSelect }: Props) {
  return (
    <div className={styles.stack}>
      {sessions.map((session) => (
        <button
          key={session.id}
          type="button"
          className={styles.bubble}
          aria-label="Open Rig conversation about this passage"
          onClick={() => onSelect(session.id)}
        >
          <DisplayBubbleGlyph />
        </button>
      ))}
    </div>
  );
}

// Its own tiny component rather than a bare "💬" string inline above:
// keeps the emoji out of the JSX a screen reader might otherwise try to
// announce alongside the button's own aria-label.
function DisplayBubbleGlyph() {
  return <span aria-hidden="true">{"\u{1F4AC}"}</span>;
}
