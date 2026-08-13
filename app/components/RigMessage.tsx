import { useEffect, useMemo, useState } from "react";
import { wordBoundaryOffsets } from "~/rig/simulateReveal";
import { parseTranscriptSegments } from "~/rig/transcriptMarkers";
import { RigMessagePill } from "./RigMessagePill";

type Props = {
  /** "agent" maps to `agent.message`, "user" to `user.message` — see
   * events.d.ts's `BetaManagedAgentsAgentMessageEvent` / `...UserMessageEvent`.
   * Named `role`, not `origin` like EntryCard: this is the live exchange
   * itself, before anything is (or isn't) pushed into the margin — origin
   * is EntryCard's vocabulary for what's already been kept. */
  role: "user" | "agent";
  /** Joined text from the event's `content` array. The real API sends an
   * array of blocks (text, and for user messages potentially image/document
   * too); joining to one string here keeps this component's contract
   * simple and pushes multi-block handling to the call site, which already
   * has to look at `content[].type` to decide what to render anyway. */
  text: string;
  /** True while an `event_delta` preview is still arriving for this
   * message's id (see `EventStreamParams.event_deltas` — `agent.message`
   * previews stream `content_delta` fragments before the buffered event
   * lands). Shows a soft trailing cursor rather than a spinner, since by
   * the time this is true there's already real text to read. */
  streaming?: boolean;
  /** True when `text` arrived as one buffered chunk instead of live
   * `event_delta` fragments (see toTranscriptItems.ts). Anthropic's own
   * docs call deltas "best-effort" — confirmed live against staging-qa,
   * watching raw SSE bytes: a real 22-second reply produced zero delta
   * frames, then one blob. Below `REVEAL_WORD_THRESHOLD` this still
   * renders instantly regardless — the animation exists to soften a
   * multi-paragraph dump landing all at once, not to add latency to a
   * one-line reply.
   */
  simulateReveal?: boolean;
  /** True for the optimistic stand-in useRigLiveSession renders ahead of a
   * just-sent message's own SSE echo (see that hook's `pendingMessage`) —
   * dimmed rather than styled as an error or a spinner, since by far the
   * likely outcome is "confirmed a moment later," not "failed." */
  pending?: boolean;
};

const REVEAL_WORD_THRESHOLD = 100;

/** Per-word delay is scaled so any reply finishes revealing within
 * `REVEAL_TOTAL_BUDGET_MS`, clamped between a floor (so a reply just over
 * the threshold doesn't reveal so fast it's indistinguishable from
 * instant) and a ceiling (so a short-ish one doesn't crawl). */
const REVEAL_MIN_MS_PER_WORD = 8;
const REVEAL_MAX_MS_PER_WORD = 22;
const REVEAL_TOTAL_BUDGET_MS = 2600;

/**
 * Only ever called for `role: "user"` — agent replies never contain the
 * `⟦pill⟧`/`⟦context⟧` markers (nothing the agent emits goes through
 * tokenPill.ts's serializer), so there's nothing to collapse in that case
 * and this stays out of the reveal-animation path entirely.
 */
function renderUserText(text: string) {
  return parseTranscriptSegments(text).map((segment, index) =>
    segment.type === "text" ? (
      <span key={index}>{segment.value}</span>
    ) : (
      <RigMessagePill key={index} segment={segment} />
    ),
  );
}

/**
 * A turn of the live conversation — not a saved note (that's EntryCard) and
 * deliberately not a chat bubble: the design direction for this pane ruled
 * bubbles out explicitly ("make 1c the main direction and drop the chat
 * bubbles"). No fill, no corners — just a quiet kicker and the text,
 * reading as part of the same notebook page as everything else in 1c's
 * right pane.
 */
export function RigMessage({ role, text, streaming = false, simulateReveal = false, pending = false }: Props) {
  const kickerLabel = role === "agent" ? "Rig" : "You";
  const kickerColorClass =
    role === "agent"
      ? "text-[var(--color-accent-700)]"
      : "text-[var(--color-accent-2-700)]";

  const offsets = useMemo(() => wordBoundaryOffsets(text), [text]);
  const shouldAnimate =
    simulateReveal && offsets.length > REVEAL_WORD_THRESHOLD;
  const [revealedWords, setRevealedWords] = useState(() =>
    shouldAnimate ? 0 : offsets.length,
  );

  useEffect(() => {
    if (!shouldAnimate) {
      setRevealedWords(offsets.length);
      return;
    }
    setRevealedWords(0);
    const msPerWord = Math.min(
      REVEAL_MAX_MS_PER_WORD,
      Math.max(REVEAL_MIN_MS_PER_WORD, REVEAL_TOTAL_BUDGET_MS / offsets.length),
    );
    let revealed = 0;
    const intervalId = setInterval(() => {
      revealed += 1;
      setRevealedWords(revealed);
      if (revealed >= offsets.length) clearInterval(intervalId);
    }, msPerWord);
    return () => clearInterval(intervalId);
    // offsets is derived from text via useMemo, not an independent input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, shouldAnimate]);

  const visibleText = shouldAnimate
    ? text.slice(0, offsets[revealedWords - 1] ?? 0)
    : text;
  const revealing = shouldAnimate && revealedWords < offsets.length;

  return (
    <div className={["py-2", pending && "opacity-50"].filter(Boolean).join(" ")}>
      <div className={["mb-1.5 text-[10px] uppercase tracking-wide", kickerColorClass].join(" ")}>{kickerLabel}</div>
      <div className="font-reading text-[14px] leading-[1.7] whitespace-pre-wrap">
        {role === "user" ? renderUserText(visibleText) : visibleText}
        {(streaming || revealing) && (
          <span className="ml-0.5 inline-block w-[0.5em] animate-pulse text-[var(--color-accent)]">
            ▊
          </span>
        )}
      </div>
    </div>
  );
}
