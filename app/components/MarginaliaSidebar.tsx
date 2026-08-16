import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import type {
  DisplayEntry,
  DisplayHighlight,
} from "~/domain/paragraph/marginalia";
import { DisplayText } from "./DisplayText";

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// A note about a Highlight, not a bare paragraph selection — the escape
// hatch from Entry's usual single-paragraph reach (see the highlightId
// comment in schema.prisma). Its own small form rather than reusing
// SelectionHighlighter's composer: there's no live text selection or
// bounding rect here, just a highlight already sitting in the sidebar.
function HighlightNoteComposer({
  highlightId,
  anchorParagraphId,
  excerpt,
  onSaved,
  optimistic,
}: {
  highlightId: string;
  anchorParagraphId: string;
  excerpt: string;
  onSaved: (paragraphIds: string[], tempIds: string[]) => void;
  optimistic: {
    addPendingEntry: (entry: {
      anchorParagraphId: string;
      highlightId: string | null;
      body: string;
      excerpt: string;
    }) => string;
    removePending: (tempId: string) => void;
  };
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const fetcher = useFetcher<{ ok: true }>();
  // The optimistic entry's own tempId, set right before the form actually
  // submits — same "ref, not fetcher.data's mere presence, marks a save as
  // fresh" reasoning SelectionHighlighter's pendingSaveRef documents.
  const pendingEntryIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !pendingEntryIdRef.current) return;
    const tempId = pendingEntryIdRef.current;
    pendingEntryIdRef.current = null;
    if (fetcher.data?.ok) {
      onSaved([anchorParagraphId], [tempId]);
    } else {
      optimistic.removePending(tempId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-ghost mt-2 text-[11px]"
        onClick={() => setOpen(true)}
      >
        <DisplayText text="Write a note" />
      </button>
    );
  }

  return (
    <fetcher.Form
      method="post"
      className="mt-2 flex flex-col gap-2"
      onSubmit={(e) => {
        if (body.trim().length === 0) {
          e.preventDefault();
          return;
        }
        pendingEntryIdRef.current = optimistic.addPendingEntry({
          anchorParagraphId,
          highlightId,
          body,
          excerpt,
        });
        setOpen(false);
        setBody("");
      }}
    >
      <input type="hidden" name="intent" value="note" />
      <input type="hidden" name="paragraphId" value={anchorParagraphId} />
      <input type="hidden" name="highlightId" value={highlightId} />
      <input type="hidden" name="excerpt" value={excerpt} />
      <textarea
        autoFocus
        className="input"
        rows={2}
        placeholder="Write in the margin…"
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setOpen(false)}
        >
          <DisplayText text="Cancel" />
        </button>
        <button type="submit" className="btn btn-primary">
          <DisplayText text="Save" />
        </button>
      </div>
    </fetcher.Form>
  );
}

// The shared card shell both the highlight list and the entry list below
// render into — same rounded-card/kicker/body layout, differing only in
// what the kicker says and whether a composer follows the body.
function MarginaliaCard({
  kicker,
  children,
  footer,
}: {
  kicker: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <li className="rounded-card bg-bg p-4">
      <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--color-accent-2-700)]">
        {kicker}
      </div>
      <div className="font-reading text-[13.5px] leading-[1.65]">
        {children}
      </div>
      {footer}
    </li>
  );
}

type Props = {
  entries: DisplayEntry[];
  highlights: DisplayHighlight[];
  /** Forwarded to HighlightNoteComposer — called with the touched
   * paragraphIds and the entry's own optimistic tempId once a note saves,
   * so the caller can refresh those paragraphs and drop the tempId once
   * the refresh lands. */
  onSaved: (paragraphIds: string[], tempIds: string[]) => void;
  /** Forwarded to HighlightNoteComposer — see SelectionHighlighter's own
   * `optimistic` prop for the shared shape/reasoning. */
  optimistic: {
    addPendingEntry: (entry: {
      anchorParagraphId: string;
      highlightId: string | null;
      body: string;
      excerpt: string;
    }) => string;
    removePending: (tempId: string) => void;
  };
};

/** The right-hand marginalia panel: highlights made today, and the hand's notes on them. */
export function MarginaliaSidebar({
  entries,
  highlights,
  onSaved,
  optimistic,
}: Props) {
  return (
    <div className="flex w-[428px] flex-none flex-col px-8 pt-8">
      <span className="font-heading text-base">
        <DisplayText text="Marginalia" />
      </span>
      {entries.length === 0 && highlights.length === 0 ? (
        <p className="mt-4 text-sm opacity-50">Nothing kept here yet.</p>
      ) : (
        <>
          {highlights.length > 0 && (
            <ul className="mt-4 flex flex-col gap-4">
              {highlights.map((h) => (
                <MarginaliaCard
                  key={h.id}
                  kicker={h.locator}
                  // A pending highlight's `id` is a client tempId, not a
                  // real Highlight the server knows about yet — offering
                  // "Write a note" on it would submit a highlightId the
                  // action can't find (see DisplayHighlight.pending).
                  footer={
                    h.pending ? undefined : (
                      <HighlightNoteComposer
                        highlightId={h.id}
                        anchorParagraphId={h.anchorParagraphId}
                        excerpt={h.text}
                        onSaved={onSaved}
                        optimistic={optimistic}
                      />
                    )
                  }
                >
                  {h.text}
                </MarginaliaCard>
              ))}
            </ul>
          )}
          {entries.length > 0 && (
            <ul className="mt-4 flex flex-col gap-4">
              {entries.map((entry) => (
                <MarginaliaCard
                  key={entry.id}
                  kicker={
                    <>
                      Your hand · {entry.locator}
                      {entry.highlightId && " · on your highlight"}
                      {entry.excerpt &&
                        ` · saved while reading "${truncate(entry.excerpt, 48)}"`}
                    </>
                  }
                >
                  {entry.body}
                </MarginaliaCard>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
