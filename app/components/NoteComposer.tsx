import { DisplayText } from "./DisplayText";
import { floatingPosition } from "./floatingPosition";

type Props = {
  rect: DOMRect;
  body: string;
  onChange: (body: string) => void;
  onCancel: () => void;
  onSave: () => void;
};

/** The floating note-composer card shown after "Write a note" on a pending selection. */
export function NoteComposer({
  rect,
  body,
  onChange,
  onCancel,
  onSave,
}: Props) {
  return (
    <div
      className="card elev-md fixed z-10 w-80 max-w-[calc(100vw-1rem)]"
      style={floatingPosition(rect)}
    >
      <textarea
        // eslint-disable-next-line jsx-a11y/no-autofocus -- only mounts in response to the reader's own "Write a note" click; moving focus into the field they just asked for is the expected behavior
        autoFocus
        className="input"
        rows={3}
        placeholder="Write in the margin…"
        value={body}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          <DisplayText text="Cancel" />
        </button>
        <button type="button" className="btn btn-primary" onClick={onSave}>
          <DisplayText text="Save" />
        </button>
      </div>
    </div>
  );
}
