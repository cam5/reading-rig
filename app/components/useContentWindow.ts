import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import {
  contentFetchTargets,
  extendContentWindow,
  type StructuralParagraph,
} from "~/domain/reading/contentWindow";
import type { OrdinalRange } from "~/domain/reading/scrollPosition";
import type { ContentWindowParagraph } from "~/domain/reading/fetchContentWindow.server";

type FetchResponse = { paragraphs: ContentWindowParagraph[] };

/**
 * One direction's fetch-on-approach behavior — factored out because
 * read.tsx needs two independent instances (a fast scroll can legitimately
 * need both directions at once; `useFetcher` only ever tracks one in-flight
 * load, so one fetcher per direction avoids queuing logic).
 *
 * `pendingRangeRef`, not `fetcher.data`'s mere presence, is what marks a
 * load as "fresh to process" — `fetcher.data` persists across the
 * fetcher's whole lifetime (same caveat MarginaliaSidebar's
 * HighlightNoteComposer documents), so without it a later, unrelated
 * re-render would re-merge the same response again.
 */
function useDirectionalFetch(
  direction: "forward" | "backward",
  needed: boolean,
  latest: { workId: string; fetchedRange: OrdinalRange; structuralParagraphs: StructuralParagraph[] },
  onLoaded: (paragraphs: ContentWindowParagraph[], range: OrdinalRange) => void,
) {
  const fetcher = useFetcher<FetchResponse>();
  const latestRef = useRef(latest);
  latestRef.current = latest;
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const pendingRangeRef = useRef<OrdinalRange | null>(null);
  // Not cleared alongside pendingRangeRef — outlives one fetch's lifetime
  // on purpose. Under fast, continuous scrolling `needed` can flip
  // false→true again in the render right after a fetch resolves, before
  // `latestRef.current.fetchedRange` (updated via the parent's own
  // setState-triggered re-render) has visibly grown to include what was
  // just merged; without this, that race re-requests the exact range that
  // just came back. Only guards against re-requesting the *same* range
  // twice in a row — a genuinely later increment always differs and
  // fires normally.
  const lastRequestedRangeRef = useRef<OrdinalRange | null>(null);

  useEffect(() => {
    if (!needed || fetcher.state !== "idle" || pendingRangeRef.current) return;
    const { workId, fetchedRange, structuralParagraphs } = latestRef.current;
    const increment = extendContentWindow(structuralParagraphs, fetchedRange, direction);
    if (!increment) return;
    const last = lastRequestedRangeRef.current;
    if (last && last.minGlobalOrdinal === increment.minGlobalOrdinal && last.maxGlobalOrdinal === increment.maxGlobalOrdinal) {
      return;
    }
    lastRequestedRangeRef.current = increment;
    pendingRangeRef.current = increment;
    fetcher.load(
      `/read-content?work=${encodeURIComponent(workId)}&min=${increment.minGlobalOrdinal}&max=${increment.maxGlobalOrdinal}`,
    );
    // latestRef/direction cover what this needs beyond `needed`/fetcher.state
    // themselves — see the ref pattern's own comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needed, fetcher.state]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || !pendingRangeRef.current) return;
    onLoadedRef.current(fetcher.data.paragraphs, pendingRangeRef.current);
    pendingRangeRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);
}

type Params = {
  workId: string;
  structuralParagraphs: StructuralParagraph[];
  /** The globalOrdinal span of whatever useVirtualizedRows currently has
   * mounted, translated by the caller — `null` before anything's been
   * measured client-side. */
  mountedOrdinalRange: OrdinalRange | null;
};

type Result = {
  contentById: Record<string, ContentWindowParagraph>;
  fetchedRange: OrdinalRange;
  /** Applies the loader's initial content window once it's streamed in
   * (see InitialContentBridge — a hook can't host its own Suspense/Await
   * boundary, so the caller mounts that and wires its resolution here).
   * Safe to call more than once; only the first call takes effect, same
   * "seed once" semantics a synchronous initializer would have had. */
  applyInitialContent: (paragraphs: ContentWindowParagraph[], range: OrdinalRange) => void;
};

/**
 * Grows the content window as the reader scrolls: starts empty (the
 * loader's initial content window is streamed, not resolved synchronously
 * — PR2), gets seeded once via `applyInitialContent`, then extends in
 * either direction via /read-content once `mountedOrdinalRange` comes
 * within lead distance of an edge that isn't the work's own boundary
 * (contentFetchTargets, app/domain/reading/contentWindow.ts).
 *
 * A short work — whole thing under the initial byte budget — never
 * fetches again: `fetchedRange` already equals the work's own bounds once
 * `applyInitialContent` runs, so contentFetchTargets always reports
 * neither direction needed, by construction rather than a special case
 * here.
 */
export function useContentWindow({ workId, structuralParagraphs, mountedOrdinalRange }: Params): Result {
  const [contentById, setContentById] = useState<Record<string, ContentWindowParagraph>>({});
  const [fetchedRange, setFetchedRange] = useState<OrdinalRange>({ minGlobalOrdinal: 0, maxGlobalOrdinal: 0 });
  // Gates contentFetchTargets below: mountedOrdinalRange goes non-null from
  // row-layout math alone (useVirtualizedRows), independent of whether the
  // streamed initial content has landed yet. Without this gate,
  // fetchedRange's zeroed starting value would read as "nothing fetched,
  // work has more" and fire a spurious forward /read-content fetch that
  // races the still-in-flight initial window — see PR2's plan.
  const [hasInitialContent, setHasInitialContent] = useState(false);
  const appliedInitialContentRef = useRef(false);

  const applyInitialContent = useCallback((paragraphs: ContentWindowParagraph[], range: OrdinalRange) => {
    if (appliedInitialContentRef.current) return;
    appliedInitialContentRef.current = true;
    setContentById(() => {
      const map: Record<string, ContentWindowParagraph> = {};
      for (const paragraph of paragraphs) map[paragraph.id] = paragraph;
      return map;
    });
    setFetchedRange(range);
    setHasInitialContent(true);
  }, []);

  const workBounds: OrdinalRange =
    structuralParagraphs.length === 0
      ? { minGlobalOrdinal: 0, maxGlobalOrdinal: 0 }
      : {
          minGlobalOrdinal: structuralParagraphs[0].globalOrdinal,
          maxGlobalOrdinal: structuralParagraphs[structuralParagraphs.length - 1].globalOrdinal,
        };

  const { needForward, needBackward } = hasInitialContent
    ? contentFetchTargets(mountedOrdinalRange, fetchedRange, workBounds)
    : { needForward: false, needBackward: false };

  function mergeLoaded(paragraphs: ContentWindowParagraph[], range: OrdinalRange) {
    setContentById((prev) => {
      const next = { ...prev };
      for (const paragraph of paragraphs) next[paragraph.id] = paragraph;
      return next;
    });
    setFetchedRange((prev) => ({
      minGlobalOrdinal: Math.min(prev.minGlobalOrdinal, range.minGlobalOrdinal),
      maxGlobalOrdinal: Math.max(prev.maxGlobalOrdinal, range.maxGlobalOrdinal),
    }));
  }

  const latest = { workId, fetchedRange, structuralParagraphs };
  useDirectionalFetch("forward", needForward, latest, mergeLoaded);
  useDirectionalFetch("backward", needBackward, latest, mergeLoaded);

  return { contentById, fetchedRange, applyInitialContent };
}
