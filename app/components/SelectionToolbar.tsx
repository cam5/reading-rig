import { DisplayText } from "./DisplayText";
import { floatingPosition } from "./floatingPosition";

type Props = {
  rect: DOMRect;
  onHighlight: (event: React.MouseEvent) => void;
  onStartNote: (event: React.MouseEvent) => void;
  onAskRig: (event: React.MouseEvent) => void;
};

/** The floating Highlight / Write-a-note / Ask-the-Rig toolbar shown over a pending text selection. */
export function SelectionToolbar({ rect, onHighlight, onStartNote, onAskRig }: Props) {
  return (
    <div className="fixed z-10 flex gap-2" style={floatingPosition(rect)}>
      <button type="button" onMouseDown={onHighlight} className="btn btn-primary">
        <DisplayText text="Highlight" />
      </button>
      <button type="button" onMouseDown={onStartNote} className="btn btn-secondary">
        <DisplayText text="Write a note" />
      </button>
      <button type="button" onMouseDown={onAskRig} className="btn btn-secondary">
        <DisplayText text="Ask the Rig" />
      </button>
    </div>
  );
}
