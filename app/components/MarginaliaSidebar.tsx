import { useEffect, useState } from "react";
import { Form, useFetcher } from "react-router";
import type { ContextSetItem } from "~/domain/contextStatement";
import type { DisplayEntry, DisplayHighlight } from "~/domain/paragraph/marginalia";
import { POSTURE_LABELS, type PostureId } from "~/domain/postures";
import { DisplayText } from "./DisplayText";
import { EntryCard } from "./EntryCard";
import { RigAnswerCard } from "./RigAnswerCard";

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

/** A Rig answer waiting to be kept or let go — see read.tsx's own
 * PendingAnswer type for why the posture/anchor/context that produced it
 * travel with the answer rather than reading back whatever's currently held. */
type PendingAnswer = { body: string; posture: PostureId };

type Props = {
  entries: (DisplayEntry & { threads: ThreadRef[] })[];
  highlights: DisplayHighlight[];
  /** Every thread that exists, for the "add to an existing thread" picker
   * on each entry — not just the ones a given entry already belongs to. */
  threads: ThreadRef[];
  /** The lens rail's currently-held posture (#27) — labels the "ask a
   * question" affordance below so it's clear which lens a submitted
   * question goes through. */
  heldPosture: PostureId;
  /** Sends a question through the held posture — the parent composes this
   * with `heldPosture` into the actual /rig turn (#26); this component
   * only owns the textarea's own draft state. */
  onAsk: (message: string) => void;
  /** #29's "last mile": a Rig answer waiting on Save to margin / Discard,
   * or null once it's been resolved one way or the other. */
  pendingAnswer: PendingAnswer | null;
  savingAnswer: boolean;
  onSaveToMargin: () => void;
  onDiscardAnswer: () => void;
  /** Whether a turn just asked is still waiting on an answer, came back
   * with nothing to keep, or neither ("idle" — nothing currently pending). */
  turnStatus: "idle" | "waiting" | "no-answer";
  onDismissNoAnswer: () => void;
  /** #29's context set for the turn about to be asked — the passage
   * that's always in view, plus whatever's been added with "+ add". */
  passageLabel: string;
  contextItems: ContextSetItem[];
  onAddContextItem: (entry: { id: string; origin: "hand" | "rig"; posture?: string; locator?: string }) => void;
  onRemoveContextItem: (id: string) => void;
  /** Invariant 3 stated as prose — app/domain/contextStatement.ts's output
   * for the same context set passageLabel/contextItems describe. */
  statement: string;
};

/** The right-hand marginalia panel: highlights made today, the hand's notes on them, and the "ask through the lens" affordance. */
export function MarginaliaSidebar({
  entries,
  highlights,
  threads,
  heldPosture,
  onAsk,
  pendingAnswer,
  savingAnswer,
  onSaveToMargin,
  onDiscardAnswer,
  turnStatus,
  onDismissNoAnswer,
  passageLabel,
  contextItems,
  onAddContextItem,
  onRemoveContextItem,
  statement,
}: Props) {
  const [question, setQuestion] = useState("");
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  function handleAskSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    onAsk(trimmed);
    setQuestion("");
  }

  return (
    <div className="flex min-h-0 w-[428px] flex-none flex-col px-8 pt-8">
      <span className="font-heading text-base">
        <DisplayText text="Marginalia" />
      </span>

      {/* #29's "last mile": the surface a Rig answer renders on before it
          becomes an Entry. Sits above the kept entries themselves — still
          provisional until Save to margin turns it into one. */}
      {pendingAnswer && (
        <div className="mt-4">
          <RigAnswerCard
            posture={POSTURE_LABELS[pendingAnswer.posture]}
            body={pendingAnswer.body}
            saving={savingAnswer}
            onSaveToMargin={onSaveToMargin}
            onDiscard={onDiscardAnswer}
          />
        </div>
      )}
      {turnStatus === "waiting" && <p className="mt-4 text-[11px] opacity-45">Waiting on the Rig…</p>}
      {turnStatus === "no-answer" && (
        <button type="button" className="mt-4 text-left text-[11px] opacity-45" onClick={onDismissNoAnswer}>
          That turn didn't come back with anything to keep.
        </button>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
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
              <ul className="mt-4 flex flex-col gap-3">
                {entries.map((entry) => (
                  <li key={entry.id} className="flex flex-col gap-2">
                    <EntryCard
                      origin={entry.origin}
                      posture={entry.posture ? POSTURE_LABELS[entry.posture] : undefined}
                      locator={entry.locator}
                      excerpt={entry.excerpt}
                      body={entry.body}
                    />
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

      {/* #29's "In view" chips + "+ add" — the context set for the turn
          about to be asked, and invariant 3 stated as prose right
          underneath: what's in view, and what plainly isn't ("Nothing
          past your bookmark"). Placement mirrors 1c's own layout, directly
          above the ask box. */}
      <div className="flex flex-none flex-col gap-1.5 pt-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] opacity-50">In view</span>
          <span className="tag tag-accent-2 text-[11px]">{passageLabel}</span>
          {contextItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="tag tag-accent-2 text-[11px]"
              onClick={() => onRemoveContextItem(item.id)}
              title="Remove from view"
            >
              {item.label} ×
            </button>
          ))}
          <div className="relative">
            <button type="button" className="tag tag-outline text-[11px]" onClick={() => setAddMenuOpen((open) => !open)}>
              + add
            </button>
            {addMenuOpen && (
              <ul className="elev-md absolute bottom-full z-10 mb-1 w-56 rounded-xl bg-surface p-1">
                {entries.filter((entry) => !contextItems.some((item) => item.id === entry.id)).length === 0 ? (
                  <li className="px-2 py-1.5 text-[11.5px] opacity-50">Nothing else on today's page.</li>
                ) : (
                  entries
                    .filter((entry) => !contextItems.some((item) => item.id === entry.id))
                    .map((entry) => {
                      const postureLabel = entry.posture ? POSTURE_LABELS[entry.posture] : undefined;
                      return (
                        <li key={entry.id}>
                          <button
                            type="button"
                            className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-[var(--color-accent-100)]"
                            onClick={() => {
                              onAddContextItem({
                                id: entry.id,
                                origin: entry.origin,
                                posture: postureLabel,
                                locator: entry.locator,
                              });
                              setAddMenuOpen(false);
                            }}
                          >
                            {entry.origin === "hand"
                              ? `your note at ${entry.locator ?? "this page"}`
                              : `${postureLabel ?? "Rig"} at ${entry.locator ?? "this page"}`}
                          </button>
                        </li>
                      );
                    })
                )}
              </ul>
            )}
          </div>
        </div>
        <p className="text-[11px] leading-[1.5] opacity-45">{statement}</p>
      </div>

      {/* Mirrors 1c's own "Write a line, or ask through the lens…" input
          at the foot of the notebook pane — the minimal affordance #27
          needs so a held posture reaches /rig at all; #28's slash palette
          and #29's context-set UI are the real invocation surface. */}
      <form onSubmit={handleAskSubmit} className="flex flex-none flex-col gap-1.5 pb-6 pt-2">
        <span className="text-[11px] opacity-50">
          Asking with <strong>{POSTURE_LABELS[heldPosture]}</strong>
        </span>
        <div className="flex items-end gap-2">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={2}
            placeholder="Write a line, or ask through the lens…"
            className="input flex-1 text-[13px]"
          />
          <button type="submit" className="btn btn-primary" aria-label="Ask">
            →
          </button>
        </div>
      </form>
    </div>
  );
}
