import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

type Params = {
  /** The scrollable reading column — the element the scroll listener
   * attaches to and whose children are searched for `[data-paragraph-id]`. */
  containerRef: React.RefObject<HTMLElement | null>;
  paragraphGlobalOrdinals: Record<string, number>;
  /** The bookmark's current globalOrdinal, if one exists yet — from the
   * loader, so a fresh page load doesn't need to scroll before it knows
   * where "not past" starts. */
  initialGlobalOrdinal: number;
};

/**
 * Writes the reading position on scroll: the furthest paragraph whose top
 * has scrolled above the reading column's own top edge. Monotonic by
 * construction — scrolling back up to re-read something earlier never
 * moves the bookmark backward, since it only ever submits when the
 * furthest-read ordinal exceeds what's already known.
 */
export function useBookmarkTracker({
  containerRef,
  paragraphGlobalOrdinals,
  initialGlobalOrdinal,
}: Params) {
  const fetcher = useFetcher();
  const knownGlobalOrdinal = useRef(initialGlobalOrdinal);

  useEffect(() => {
    knownGlobalOrdinal.current = initialGlobalOrdinal;
  }, [initialGlobalOrdinal]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let frame: number | null = null;

    function handleScroll() {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const current = containerRef.current;
        if (!current) return;

        const containerTop = current.getBoundingClientRect().top;
        let furthestOrdinal = -1;
        let furthestParagraphId: string | null = null;

        for (const el of current.querySelectorAll<HTMLElement>("[data-paragraph-id]")) {
          // "Read past" once its top has scrolled above the column's own
          // top edge (a small threshold, not the exact pixel, so a
          // paragraph just barely crossing the line still counts).
          if (el.getBoundingClientRect().top - containerTop < 40) {
            const id = el.dataset.paragraphId;
            const ordinal = id ? paragraphGlobalOrdinals[id] : undefined;
            if (id && ordinal !== undefined && ordinal > furthestOrdinal) {
              furthestOrdinal = ordinal;
              furthestParagraphId = id;
            }
          }
        }

        if (furthestParagraphId && furthestOrdinal > knownGlobalOrdinal.current) {
          knownGlobalOrdinal.current = furthestOrdinal;
          fetcher.submit(
            { intent: "bookmark", paragraphId: furthestParagraphId },
            { method: "post" },
          );
        }
      });
    }

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [containerRef, paragraphGlobalOrdinals]);
}
