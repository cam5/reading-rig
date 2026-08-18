import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import type {
  DisplayEntry,
  DisplayHighlight,
} from "~/domain/paragraph/marginalia";
import { DisplayText } from "./DisplayText";
import { Kicker } from "./Kicker";
import { SegTab } from "./SegTab";
import styles from "./MarginaliaSidebar.module.css";

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
        className={["btn btn-ghost mt-2", styles.composerButton].join(" ")}
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
    <li className={["bg-bg p-4", styles.card].join(" ")}>
      <Kicker tone="accent-2" className="mb-2 block">
        {kicker}
      </Kicker>
      <div className={["font-reading", styles.body].join(" ")}>{children}</div>
      {footer}
    </li>
  );
}

type Props = {
  workId: string;
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
  /** Opens the live Rig panel — see RigLivePanel, rendered by the route
   * that owns this sidebar. Just a launcher here: the sidebar itself has
   * no opinion on whether the panel is open. */
  onOpenRig: () => void;
};

/** The right-hand marginalia panel: the Rig launcher and Reading/Commonplace switch up top, then highlights made today and the hand's notes on them. */
export function MarginaliaSidebar({
  workId,
  entries,
  highlights,
  onSaved,
  optimistic,
  onOpenRig,
}: Props) {
  return (
    <aside
      aria-label="Marginalia"
      className={[
        "flex flex-none flex-col overflow-y-auto px-8 py-8",
        styles.sidebar,
      ].join(" ")}
    >
      <div className="flex items-center gap-4">
        <button type="button" className="btn btn-secondary" onClick={onOpenRig}>
          <DisplayText text="Ask the Rig" />
        </button>
        <div className="seg">
          <SegTab to={`/read/${workId}`} active>
            Reading
          </SegTab>
          <SegTab to="/commonplace">Commonplace</SegTab>
        </div>
      </div>
      {entries.length === 0 && highlights.length === 0 ? (
        <p className={["mt-4", styles.empty].join(" ")}>
          Nothing kept here yet.
        </p>
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
    </aside>
  );
}
