import { DisplayText } from "./DisplayText";
import { floatingPosition } from "./floatingPosition";

type Props = {
  rect: DOMRect;
  onHighlight: (event: React.MouseEvent) => void;
  onStartNote: (event: React.MouseEvent) => void;
};

// Rough width guess for viewport clamping — floatingPosition can't measure
// a not-yet-mounted element, and this toolbar's two buttons never wrap.
const TOOLBAR_WIDTH_PX = 230;

/** The floating Highlight / Write-a-note toolbar shown over a pending text selection. */
export function SelectionToolbar({ rect, onHighlight, onStartNote }: Props) {
  return (
    <div className="fixed z-10 flex gap-2" style={floatingPosition(rect, TOOLBAR_WIDTH_PX)}>
      <button type="button" onMouseDown={onHighlight} className="btn btn-primary">
        <DisplayText text="Highlight" />
      </button>
      <button type="button" onMouseDown={onStartNote} className="btn btn-secondary">
        <DisplayText text="Write a note" />
      </button>
    </div>
  );
}
