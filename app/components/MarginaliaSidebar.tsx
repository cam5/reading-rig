import { useEffect, useState, type ReactNode } from "react";
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
}: {
  highlightId: string;
  anchorParagraphId: string;
  excerpt: string;
  onSaved: (paragraphIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const fetcher = useFetcher<{ ok: true }>();

  // fetcher.data persists across the fetcher's whole lifetime, not just the
  // submission that produced it — only react to a *fresh* success by
  // watching fetcher.state's transition back to idle, not fetcher.data's
  // mere presence (which would also fire on reopening after an earlier save).
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setOpen(false);
      setBody("");
      onSaved([anchorParagraphId]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state]);

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
        if (body.trim().length === 0) e.preventDefault();
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
   * paragraphIds once a note saves, so the caller can refresh them. */
  onSaved: (paragraphIds: string[]) => void;
  /** Opens the live Rig panel — see RigLivePanel, rendered by the route
   * that owns this sidebar. Just a launcher here: the sidebar itself has
   * no opinion on whether the panel is open. */
  onOpenRig: () => void;
  /** Mobile-only: whether the sidebar is open as a full-screen overlay.
   * Ignored at the `md` breakpoint and up, where it's always visible
   * inline — same shape as RigPanel's open/close. */
  open: boolean;
  onClose: () => void;
};

/** The right-hand marginalia panel: the Rig launcher and Reading/Commonplace switch up top, then highlights made today and the hand's notes on them. Below `md` it's a full-screen overlay instead of an inline column — see .sidebar's media query. */
export function MarginaliaSidebar({
  workId,
  entries,
  highlights,
  onSaved,
  onOpenRig,
  open,
  onClose,
}: Props) {
  return (
    <aside
      aria-label="Marginalia"
      className={[
        "flex flex-col overflow-y-auto bg-surface px-8 py-8 md:flex-none",
        styles.sidebar,
        open ? styles.sidebarOpen : "",
      ].join(" ")}
    >
      {/* flex-wrap + ml-auto on Close: at md+ Close never renders (see its
          own md:hidden!) so this row is exactly upstream's original
          Ask-the-Rig + seg-tabs row, untouched. Below md, Close joins the
          same row and wraps onto its own line if the other two don't
          leave room — same organic.css `.btn` !important note as the
          margin-launcher button in read.tsx. */}
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className="btn btn-secondary" onClick={onOpenRig}>
          <DisplayText text="Ask the Rig" />
        </button>
        <div className="seg">
          <SegTab to={`/read/${workId}`} active>
            Reading
          </SegTab>
          <SegTab to="/commonplace">Commonplace</SegTab>
        </div>
        <button
          type="button"
          className="btn btn-ghost ml-auto md:hidden!"
          onClick={onClose}
        >
          <DisplayText text="Close" />
        </button>
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
                  footer={
                    <HighlightNoteComposer
                      highlightId={h.id}
                      anchorParagraphId={h.anchorParagraphId}
                      excerpt={h.text}
                      onSaved={onSaved}
                    />
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
