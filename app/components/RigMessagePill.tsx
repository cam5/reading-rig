import type { TranscriptSegment } from "~/rig/transcriptMarkers";
import { formatPillLabel } from "./tokenPill";

type Props = {
  segment: Extract<TranscriptSegment, { type: "pill" | "context" }>;
};

/**
 * A collapsed pill in the read-only transcript, standing in for a
 * `⟦pill⟧`/`⟦context⟧` span (transcriptMarkers.ts) that would otherwise show
 * up as raw quoted text or a multi-paragraph prose blob. Unlike
 * tokenPill.ts's `createPillElement`, this is a real React component — the
 * transcript is a static render, not a contentEditable field, so there's no
 * caret to protect by keeping React out of the subtree.
 *
 * `title` (native tooltip) is the expand mechanism, matching how the
 * composer's own pills reveal their full source text.
 */
export function RigMessagePill({ segment }: Props) {
  const label = segment.type === "context" ? "Reading context" : formatPillLabel(segment.kind, segment.locator, segment.text);
  return (
    <span className="tag tag-accent mx-0.5 cursor-default select-none" title={segment.text}>
      {label}
    </span>
  );
}
