import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { DisplayEntry, DisplayHighlight } from "~/domain/paragraph/marginalia";
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
}: {
  highlightId: string;
  anchorParagraphId: string;
  excerpt: string;
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state]);

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost mt-2 text-[11px]" onClick={() => setOpen(true)}>
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
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          <DisplayText text="Cancel" />
        </button>
        <button type="submit" className="btn btn-primary">
          <DisplayText text="Save" />
        </button>
      </div>
    </fetcher.Form>
  );
}

type Props = {
  entries: DisplayEntry[];
  highlights: DisplayHighlight[];
};

/**
 * Highlights made today, and the hand's notes on them. No width or padding
 * of its own — it renders both as the inline `desk`-width column and inside
 * the mobile drawer (app/routes/read.tsx), and those two containers size and
 * pad it differently.
 */
export function MarginaliaSidebar({ entries, highlights }: Props) {
  return (
    <div className="flex flex-col">
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
                <li key={h.id} className="rounded-[22px] bg-bg p-4">
                  <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--color-accent-2-700)]">
                    {h.locator}
                  </div>
                  <div className="font-reading text-[13.5px] leading-[1.65]">{h.text}</div>
                  <HighlightNoteComposer highlightId={h.id} anchorParagraphId={h.anchorParagraphId} excerpt={h.text} />
                </li>
              ))}
            </ul>
          )}
          {entries.length > 0 && (
            <ul className="mt-4 flex flex-col gap-4">
              {entries.map((entry) => (
                <li key={entry.id} className="rounded-[22px] bg-bg p-4">
                  <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--color-accent-2-700)]">
                    Your hand · {entry.locator}
                    {entry.highlightId && " · on your highlight"}
                    {entry.excerpt && ` · saved while reading "${truncate(entry.excerpt, 48)}"`}
                  </div>
                  <div className="font-reading text-[13.5px] leading-[1.65]">{entry.body}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
