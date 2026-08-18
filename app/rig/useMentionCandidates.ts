import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { MentionCandidate } from "~/domain/reading/searchMentionCandidates.server";

/** Tuned for keystroke latency, not useBookmarkTracker's scroll-settle
 * 400ms — this is driving a live autocomplete popup, not a background
 * position sync. */
const MENTION_QUERY_DEBOUNCE_MS = 150;

type FetchResponse = { suggestions: MentionCandidate[] };

/**
 * Debounced "@"-mention suggestions for TokenComposer, fetched from
 * /api/v1/mention-suggestions as the user types after "@" — paragraphs and (#117
 * follow-up) notes whose body matches, merged and ranked server-side.
 * Modeled on useContentWindow's useFetcher idiom: a single useFetcher only
 * ever tracks one in-flight load, so a later keystroke's request naturally
 * supersedes an earlier one without manual AbortController plumbing.
 *
 * `query === null` means no "@" is active (popup closed) — no fetch,
 * suggestions reset to empty. `query === ""` (a bare "@") is a real
 * request: the endpoint treats a blank query as "closest to my bookmark."
 *
 * A debounced request that resolves after the popup has since closed can
 * still land here and repopulate `suggestions` — harmless, since the
 * composer gates the popup's visibility on `query !== null`, not on
 * whether this array is empty.
 */
export function useMentionCandidates(
  workId: string,
  query: string | null,
): { suggestions: MentionCandidate[]; loading: boolean } {
  const fetcher = useFetcher<FetchResponse>();
  const [suggestions, setSuggestions] = useState<MentionCandidate[]>([]);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (query === null) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      fetcherRef.current.load(
        `/api/v1/mention-suggestions?work=${encodeURIComponent(workId)}&q=${encodeURIComponent(query)}`,
      );
    }, MENTION_QUERY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [workId, query]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      setSuggestions(fetcher.data.suggestions);
    }
  }, [fetcher.state, fetcher.data]);

  return { suggestions, loading: fetcher.state !== "idle" };
}
