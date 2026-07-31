import { floatingPosition } from "./floatingPosition";

type Props = {
  rect: DOMRect;
  onHighlight: (event: React.MouseEvent) => void;
  onStartNote: (event: React.MouseEvent) => void;
};

/** The floating Highlight / Write-a-note toolbar shown over a pending text selection. */
export function SelectionToolbar({ rect, onHighlight, onStartNote }: Props) {
  return (
    <div className="fixed z-10 flex gap-2" style={floatingPosition(rect)}>
      <button type="button" onMouseDown={onHighlight} className="btn btn-primary">
        Highlight
      </button>
      <button type="button" onMouseDown={onStartNote} className="btn btn-secondary">
        Write a note
      </button>
    </div>
  );
}
