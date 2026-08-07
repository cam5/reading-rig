import type { ReactNode } from "react";
import { DisplayText } from "./DisplayText";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Shown in the panel's own small header — the work's title, so the
   * panel still reads correctly if it's ever reused somewhere other than
   * directly over the reading view it's launched from. */
  title: string;
  /** An optional extra header control between the title and Close — e.g.
   * RigLivePanel's session picker. Kept as a slot rather than RigPanel
   * importing RigSessionMenu itself, so this stays session/transcript-free
   * per its own doc comment below. */
  headerExtra?: ReactNode;
  children: ReactNode;
};

/**
 * The slide-out chrome only — no session/transcript logic of its own (see
 * RigLivePanel for the connected version). A floating overlay, not a modal:
 * no backdrop, so the reading view underneath stays interactive while it's
 * open — this is a companion panel a reader dips into, not a dialog that
 * demands full attention. `translate-x-full` when closed keeps it mounted
 * (rather than conditionally rendered) so `RigLivePanel`'s live session
 * connection survives a close/reopen instead of tearing down and
 * reconnecting from scratch.
 */
export function RigPanel({ open, onClose, title, headerExtra, children }: Props) {
  return (
    <div
      className={[
        "elev-lg fixed inset-y-0 right-0 z-20 flex w-[420px] flex-col rounded-l-[28px] bg-surface transition-transform duration-300 ease-out",
        open ? "translate-x-0" : "translate-x-full",
      ].join(" ")}
      aria-hidden={!open}
    >
      <div className="flex flex-none items-center gap-3 border-b border-divider px-6 py-4">
        <span className="font-heading text-base">
          <DisplayText text="Reading Rig" />
        </span>
        <span className="text-[12.5px] opacity-60">{title}</span>
        {headerExtra}
        <button type="button" className="btn btn-ghost ml-auto text-[12px]" onClick={onClose}>
          <DisplayText text="Close" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-3">{children}</div>
    </div>
  );
}
