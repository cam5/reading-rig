import { useEffect, useRef } from "react";
import { useRigLiveSession } from "~/rig/useRigLiveSession";
import { RigPanel } from "./RigPanel";
import { RigStatus } from "./RigStatus";
import { RigTranscript } from "./RigTranscript";
import { TokenComposer } from "./TokenComposer";

type Props = {
  workId: string;
  workTitle: string;
  open: boolean;
  onClose: () => void;
  /** Built by buildRigLaunchContext (title/author + whatever prompted this
   * open — a highlighted excerpt, or the passage currently on screen).
   * `null` when there's nothing to say beyond the reader's own question. */
  context: string | null;
};

/**
 * Wires RigPanel's chrome to a real session via useRigLiveSession — the one
 * place in this feature that talks to the network, so (like
 * MarginaliaSidebar's HighlightNoteComposer) it has no Storybook story of
 * its own; there's no backend for it to call there.
 */
export function RigLivePanel({ workId, workTitle, open, onClose, context }: Props) {
  const { items, busy, error, send } = useRigLiveSession(workId, open);

  // `context` is only accurate for the moment this open happened — reset
  // the "still needs sending" flag on every fresh open rather than once
  // per session, so a later open with a different excerpt/viewport still
  // gets said, even though the session itself is the same long-lived one.
  const contextPendingRef = useRef(false);
  useEffect(() => {
    if (open) contextPendingRef.current = true;
  }, [open]);

  // `text` arrives already serialized and trimmed from TokenComposer, which
  // owns its own content — mention pills have to become quoted passages
  // before anything up here can prepend to them.
  function handleSend(text: string) {
    if (!text) return;
    if (contextPendingRef.current && context) {
      send(`${context}\n\n${text}`);
    } else {
      send(text);
    }
    contextPendingRef.current = false;
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
        <TokenComposer workId={workId} onSend={handleSend} disabled={busy} />
      </div>
    </RigPanel>
  );
}
