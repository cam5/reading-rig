import { useEffect, useState } from "react";
import { Form, useFetcher } from "react-router";
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

type ThreadRef = { id: string; title: string };

type Props = {
  entries: (DisplayEntry & { threads: ThreadRef[] })[];
  highlights: DisplayHighlight[];
  /** Every thread that exists, for the "add to an existing thread" picker
   * on each entry — not just the ones a given entry already belongs to. */
  threads: ThreadRef[];
};

/** The right-hand marginalia panel: highlights made today, and the hand's notes on them. */
export function MarginaliaSidebar({ entries, highlights, threads }: Props) {
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
                <li key={entry.id} className="flex flex-col gap-2">
                  <div className="rounded-[22px] bg-bg p-4">
                    <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--color-accent-2-700)]">
                      Your hand · {entry.locator}
                      {entry.highlightId && " · on your highlight"}
                      {entry.excerpt && ` · saved while reading "${truncate(entry.excerpt, 48)}"`}
                    </div>
                    <div className="font-reading text-[13.5px] leading-[1.65]">{entry.body}</div>
                  </div>
                  {entry.threads.length > 0 && (
                    <p className="px-1 text-[11px] opacity-55">
                      In: {entry.threads.map((t) => t.title).join(", ")}
                    </p>
                  )}
                  {/* Minimal, deliberately — a name and a submit, nothing
                      fancier yet (issue #21). Sibling to the entry card, not
                      a change to it. */}
                  <div className="flex flex-col gap-1.5 px-1">
                    <Form method="post" className="flex gap-1.5">
                      <input type="hidden" name="intent" value="createThread" />
                      <input type="hidden" name="entryId" value={entry.id} />
                      <input
                        type="text"
                        name="title"
                        placeholder="Start a thread…"
                        className="input flex-1 text-[12px]"
                      />
                      <button type="submit" className="btn btn-secondary text-[11px]">
                        Start
                      </button>
                    </Form>
                    {threads.length > 0 && (
                      <Form method="post" className="flex gap-1.5">
                        <input type="hidden" name="intent" value="addToThread" />
                        <input type="hidden" name="entryId" value={entry.id} />
                        <select name="threadId" defaultValue="" className="input flex-1 text-[12px]">
                          <option value="" disabled>
                            Add to thread…
                          </option>
                          {threads.map((thread) => (
                            <option key={thread.id} value={thread.id}>
                              {thread.title}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="btn btn-secondary text-[11px]">
                          Add
                        </button>
                      </Form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
