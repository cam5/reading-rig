import { useState } from "react";
import { useRigLiveSession } from "~/rig/useRigLiveSession";
import { RigComposer } from "./RigComposer";
import { RigPanel } from "./RigPanel";
import { RigStatus } from "./RigStatus";
import { RigTranscript } from "./RigTranscript";

type Props = {
  workId: string;
  workTitle: string;
  open: boolean;
  onClose: () => void;
};

/**
 * Wires RigPanel's chrome to a real session via useRigLiveSession — the one
 * place in this feature that talks to the network, so (like
 * MarginaliaSidebar's HighlightNoteComposer) it has no Storybook story of
 * its own; there's no backend for it to call there.
 */
export function RigLivePanel({ workId, workTitle, open, onClose }: Props) {
  const [draft, setDraft] = useState("");
  const { items, busy, error, send } = useRigLiveSession(workId, open);

  function handleSend() {
    send(draft);
    setDraft("");
  }

  return (
    <RigPanel open={open} onClose={onClose} title={workTitle}>
      {items.length === 0 && !busy && !error && (
        <p className="text-[13px] opacity-50">Ask about the passage in view, or anything else on your shelf.</p>
      )}
      <RigTranscript items={items} />
      {busy && <RigStatus status="running" />}
      {error && <RigStatus status="error" message={error} />}
      <div className="mt-auto pt-3">
        <RigComposer value={draft} onChange={setDraft} onSend={handleSend} disabled={busy} />
      </div>
    </RigPanel>
  );
}
