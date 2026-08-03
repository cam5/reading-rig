import { DisplayText } from "./DisplayText";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  /** True while the session is running a turn — the composer stays
   * visible and editable (queuing a next thought is fine) but the send
   * button disables, since `POST /rig/*` sends into the same session a
   * pending turn is already occupying. */
  disabled?: boolean;
  /** 1c's own copy: "Write a line, or ask through the lens…" — kept as a
   * default rather than hardcoded so a call site scoped to a narrower
   * moment (e.g. mid-turn) can override it. */
  placeholder?: string;
};

/**
 * The Rig's own input line — same `.input` treatment as NoteComposer's
 * textarea, but single-line and paired with Button's `icon` variant for
 * the "→" send action Button.tsx's own comment already anticipates.
 */
export function RigComposer({
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder = "Write a line, or ask through the lens…",
}: Props) {
  return (
    <div className="flex items-end gap-2">
      <textarea
        className="input flex-1"
        rows={1}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (value.trim() && !disabled) onSend();
          }
        }}
      />
      <button
        type="button"
        className="btn btn-primary btn-icon"
        disabled={disabled || !value.trim()}
        onClick={onSend}
        aria-label="Send"
      >
        <DisplayText text="→" />
      </button>
    </div>
  );
}
