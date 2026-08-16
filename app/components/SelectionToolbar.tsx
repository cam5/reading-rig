import { calloutPosition } from "./calloutPosition";

type Props = {
  rect: DOMRect;
  onHighlight: (event: React.MouseEvent) => void;
  onStartNote: (event: React.MouseEvent) => void;
  onAskRig: (event: React.MouseEvent) => void;
};

/**
 * The floating Highlight / Write-a-note / Ask-the-Rig callout shown over a
 * pending text selection, once SelectionHighlighter has committed it (see
 * its own doc comment for why that's on pointerup, not live during a drag).
 * Styled as an iOS-style selection callout — see the `.selection-callout*`
 * doc comment in organic.css.
 */
export function SelectionToolbar({
  rect,
  onHighlight,
  onStartNote,
  onAskRig,
}: Props) {
  return (
    <div className="selection-callout" style={calloutPosition(rect)}>
      <div className="selection-callout-pill">
        <button type="button" onMouseDown={onHighlight}>
          Highlight
        </button>
        <button type="button" onMouseDown={onStartNote}>
          Write a note
        </button>
        <button type="button" onMouseDown={onAskRig}>
          Ask the Rig
        </button>
      </div>
      <div className="selection-callout-caret" />
    </div>
  );
}
