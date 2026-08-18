import { useState } from "react";
import type {
  PendingEntry,
  PendingHighlight,
} from "~/domain/paragraph/marginalia";

type TrackedPendingHighlight = PendingHighlight & {
  // Same role `Highlight.createdAt.getTime()` plays for a real one —
  // ReadingParagraph's `order` prop, newest-outermost. Stamped once, at
  // add time, so it stays stable across re-renders.
  createdAt: number;
};

type SpanInput = { paragraphId: string; start: number; end: number };

function makeTempId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/**
 * Client-only "it happened" state for a highlight/note between the moment
 * a reader clicks Highlight/Save and the moment useContentWindow's own
 * refetch (triggered once the save's POST resolves — see read.tsx's
 * handleAnnotationSaved) brings back the server-confirmed version. Kept
 * separate from useContentWindow itself: nothing here ever talks to the
 * server, it's pure bookkeeping for "what's been optimistically shown"
 * so it can come back down again once the real data supersedes it, or the
 * save fails.
 *
 * A pending item's tempId is never resolved to a real id — it's just
 * taken down (removePending) once no longer needed. Both success (the
 * refetch landed) and failure (the save never happened) end the same way,
 * since a pending item carries no state a caller would need to tell those
 * two apart by.
 */
export function useOptimisticAnnotations() {
  const [pendingHighlights, setPendingHighlights] = useState<
    TrackedPendingHighlight[]
  >([]);
  const [pendingEntries, setPendingEntries] = useState<PendingEntry[]>([]);

  function addPendingHighlight(spans: SpanInput[]): string {
    const tempId = makeTempId("pending-highlight");
    setPendingHighlights((prev) => [
      ...prev,
      { tempId, spans, createdAt: Date.now() },
    ]);
    return tempId;
  }

  function addPendingEntry(entry: Omit<PendingEntry, "tempId">): string {
    const tempId = makeTempId("pending-entry");
    setPendingEntries((prev) => [...prev, { tempId, ...entry }]);
    return tempId;
  }

  function removePending(tempId: string) {
    setPendingHighlights((prev) => prev.filter((h) => h.tempId !== tempId));
    setPendingEntries((prev) => prev.filter((e) => e.tempId !== tempId));
  }

  return {
    pendingHighlights,
    pendingEntries,
    addPendingHighlight,
    addPendingEntry,
    removePending,
  };
}
