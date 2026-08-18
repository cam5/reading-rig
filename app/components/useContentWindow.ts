import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import {
  contentFetchTargets,
  extendContentWindow,
  DEFAULT_CONTENT_FETCH_LEAD_PARAGRAPHS,
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
  latest: {
    workId: string;
    fetchedRange: OrdinalRange;
    structuralParagraphs: StructuralParagraph[];
  },
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
    const increment = extendContentWindow(
      structuralParagraphs,
      fetchedRange,
      direction,
    );
    if (!increment) return;
    const last = lastRequestedRangeRef.current;
    if (
      last &&
      last.minGlobalOrdinal === increment.minGlobalOrdinal &&
      last.maxGlobalOrdinal === increment.maxGlobalOrdinal
    ) {
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
    if (fetcher.state !== "idle" || !fetcher.data || !pendingRangeRef.current)
      return;
    onLoadedRef.current(fetcher.data.paragraphs, pendingRangeRef.current);
    pendingRangeRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);
}

/**
 * Refetches specific paragraphs' highlightSpans/entries by id, on demand
 * rather than in response to scroll — the merge target for "a highlight or
 * note was just saved for these paragraphs" (read.tsx wires this to
 * SelectionHighlighter/MarginaliaSidebar's own fetchers via a callback).
 * `/read-content`'s loader only takes an ordinal range, not a paragraph-id
 * list, so this resolves the touched ids to the smallest range spanning
 * them via `structuralParagraphs` and refetches that — the same endpoint
 * and shape `useDirectionalFetch` already uses, just triggered by a save
 * instead of a scroll edge.
 *
 * Requests queue rather than overlap: `useFetcher` only tracks one
 * in-flight load, so a second save arriving before the first refetch
 * resolves is folded into the ids fired on the *next* `fire()`, once the
 * fetcher goes idle again — same reasoning as `useDirectionalFetch`'s
 * single-in-flight-per-direction contract.
 */
function useParagraphRefresh(
  workId: string,
  structuralParagraphs: StructuralParagraph[],
  onLoaded: (paragraphs: ContentWindowParagraph[], range: OrdinalRange) => void,
): (paragraphIds: string[]) => void {
  const fetcher = useFetcher<FetchResponse>();
  const structuralRef = useRef(structuralParagraphs);
  structuralRef.current = structuralParagraphs;
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const queuedIdsRef = useRef<Set<string>>(new Set());
  const pendingRangeRef = useRef<OrdinalRange | null>(null);

  function fire() {
    if (
      fetcher.state !== "idle" ||
      pendingRangeRef.current ||
      queuedIdsRef.current.size === 0
    )
      return;
    const ids = queuedIdsRef.current;
    queuedIdsRef.current = new Set();
    const ordinals = structuralRef.current
      .filter((p) => ids.has(p.id))
      .map((p) => p.globalOrdinal);
    if (ordinals.length === 0) return;
    const range = {
      minGlobalOrdinal: Math.min(...ordinals),
      maxGlobalOrdinal: Math.max(...ordinals),
    };
    pendingRangeRef.current = range;
    fetcher.load(
      `/read-content?work=${encodeURIComponent(workId)}&min=${range.minGlobalOrdinal}&max=${range.maxGlobalOrdinal}`,
    );
  }

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || !pendingRangeRef.current)
      return;
    onLoadedRef.current(fetcher.data.paragraphs, pendingRangeRef.current);
    pendingRangeRef.current = null;
    fire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  return function refreshParagraphs(paragraphIds: string[]) {
    for (const id of paragraphIds) queuedIdsRef.current.add(id);
    fire();
  };
}

type Params = {
  workId: string;
  structuralParagraphs: StructuralParagraph[];
  initialContent: { paragraphs: ContentWindowParagraph[] } & OrdinalRange;
  /** The globalOrdinal span of whatever useVirtualizedRows currently has
   * mounted, translated by the caller — `null` before anything's been
   * measured client-side. */
  mountedOrdinalRange: OrdinalRange | null;
  /** How far back the reader has explicitly asked to load. Content behind
   * this is never fetched on approach — see contentFetchTargets. */
  backwardFloorOrdinal?: number;
};

type Result = {
  contentById: Record<string, ContentWindowParagraph>;
  fetchedRange: OrdinalRange;
  /** Call with the paragraphIds a just-saved highlight/note touched, once
   * its fetcher resolves ok — refetches their highlightSpans/entries and
   * merges them in, so the read route reflects a save without a full page
   * reload. */
  refreshParagraphs: (paragraphIds: string[]) => void;
};

/**
 * Grows the content window as the reader scrolls: seeds from the loader's
 * initial fetch (synchronous, identical on server and client — no
 * hydration mismatch for the paragraphs already there), then extends in
 * either direction via /read-content once `mountedOrdinalRange` comes
 * within lead distance of an edge that isn't the work's own boundary
 * (contentFetchTargets, app/domain/reading/contentWindow.ts).
 *
 * A short work — whole thing under the initial byte budget — never
 * fetches again: `fetchedRange` already equals the work's own bounds from
 * the first load, so contentFetchTargets always reports neither direction
 * needed, by construction rather than a special case here.
 */
export function useContentWindow({
  workId,
  structuralParagraphs,
  initialContent,
  mountedOrdinalRange,
  backwardFloorOrdinal,
}: Params): Result {
  const [contentById, setContentById] = useState<
    Record<string, ContentWindowParagraph>
  >(() => {
    const map: Record<string, ContentWindowParagraph> = {};
    for (const paragraph of initialContent.paragraphs)
      map[paragraph.id] = paragraph;
    return map;
  });
  const [fetchedRange, setFetchedRange] = useState<OrdinalRange>({
    minGlobalOrdinal: initialContent.minGlobalOrdinal,
    maxGlobalOrdinal: initialContent.maxGlobalOrdinal,
  });

  const workBounds: OrdinalRange =
    structuralParagraphs.length === 0
      ? { minGlobalOrdinal: 0, maxGlobalOrdinal: 0 }
      : {
          minGlobalOrdinal: structuralParagraphs[0].globalOrdinal,
          maxGlobalOrdinal:
            structuralParagraphs[structuralParagraphs.length - 1].globalOrdinal,
        };

  const { needForward, needBackward } = contentFetchTargets(
    mountedOrdinalRange,
    fetchedRange,
    workBounds,
    DEFAULT_CONTENT_FETCH_LEAD_PARAGRAPHS,
    backwardFloorOrdinal ?? workBounds.minGlobalOrdinal,
  );

  function mergeLoaded(
    paragraphs: ContentWindowParagraph[],
    range: OrdinalRange,
  ) {
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
  const refreshParagraphs = useParagraphRefresh(
    workId,
    structuralParagraphs,
    mergeLoaded,
  );

  return { contentById, fetchedRange, refreshParagraphs };
}
