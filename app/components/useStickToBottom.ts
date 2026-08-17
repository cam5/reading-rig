import { useEffect, useRef } from "react";

// How close to the bottom edge (in px) still counts as "at the bottom" —
// gives a little slack for sub-pixel scroll math instead of requiring an
// exact 0.
const BOTTOM_THRESHOLD_PX = 32;

/**
 * Keeps a scroll container pinned to its bottom edge as content grows,
 * without fighting a reader who has scrolled up to reread something
 * earlier. Pinned state is tracked from the container's own scroll
 * position rather than a flag the caller manages: scrolling away from the
 * bottom un-pins, scrolling back down re-pins.
 *
 * Re-sticking is driven by a MutationObserver on the container itself
 * rather than a caller-supplied dependency list — deliberately, since a
 * dep list only catches growth that shows up as a prop change. RigMessage's
 * word-reveal animation grows a message's text (and this container's
 * scrollHeight) via its own internal setInterval for up to ~2.6s *after*
 * the item holding it was already added to `items`; a `[items, busy]`
 * dependency array never sees that later growth. Watching the DOM directly
 * catches that and anything else that grows the transcript, with no
 * caller-side wiring required.
 */
export function useStickToBottom<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function handleScroll() {
      if (!el) return;
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      pinnedRef.current = distanceFromBottom <= BOTTOM_THRESHOLD_PX;
    }

    function stickIfPinned() {
      if (!el || !pinnedRef.current) return;
      el.scrollTop = el.scrollHeight;
    }

    const observer = new MutationObserver(stickIfPinned);
    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    el.addEventListener("scroll", handleScroll, { passive: true });
    // Lands at the bottom of whatever's already in the container the
    // moment it's observed — e.g. reopening the panel on an existing
    // session, where the transcript arrives before this effect runs.
    stickIfPinned();

    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", handleScroll);
    };
  }, []);

  // For an action that should always jump to the bottom regardless of
  // current pin state — e.g. the reader hitting Enter to send a message.
  function scrollToBottom() {
    const el = ref.current;
    if (!el) return;
    pinnedRef.current = true;
    el.scrollTop = el.scrollHeight;
  }

  return { ref, scrollToBottom };
}
