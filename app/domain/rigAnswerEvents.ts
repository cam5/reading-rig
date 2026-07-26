/**
 * Pulling a Rig answer's text out of the SSE events app/routes/rig.tsx's
 * GET loader relays — the read side of #29's "save to margin", which
 * needs the answer's actual body before there's anything to save.
 *
 * Field names below are read off the installed SDK's own event
 * interfaces (node_modules/@anthropic-ai/sdk/resources/beta/sessions/
 * events.d.ts — `BetaManagedAgentsAgentMessageEvent`,
 * `BetaManagedAgentsSessionStatusIdleEvent`), the same discipline
 * anthropicSessionSource.ts already states for RigSessionEvent: a
 * structural subset of the real union, not an invented shape. Unlike
 * that file, this one *is* exercised by a test (rigAnswerEvents.test.ts),
 * against literal objects shaped like those interfaces — there's still no
 * live session to run it against, but the parsing logic itself has real
 * coverage.
 *
 * `agent.message`'s own doc comment is worth restating: its `content` is
 * "an array of text blocks comprising the agent response" — already
 * assembled, not a `content_delta` fragment to accumulate. That's what
 * keeps this a one-shot extraction rather than a streaming reducer.
 */
export type RawRigEvent = { type: string; [key: string]: unknown };

function isTextBlock(value: unknown): value is { type: "text"; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).type === "text" &&
    typeof (value as Record<string, unknown>).text === "string"
  );
}

/** Non-null only for an `agent.message` event carrying at least one text
 * block — an empty/all-non-text `content` array (thinking-only turns,
 * tool-call-only turns) comes back null, same as an event of any other
 * type. */
export function extractAgentMessageText(event: RawRigEvent): string | null {
  if (event.type !== "agent.message") return null;
  const content = event.content;
  if (!Array.isArray(content)) return null;
  const text = content.filter(isTextBlock).map((block) => block.text).join("");
  return text.length > 0 ? text : null;
}

/** True only for `session.status_idle` with `stop_reason.type ===
 * "end_turn"` — the turn finished naturally with nothing left to say.
 * `requires_action` (mid-tool-call) and `retries_exhausted` are both left
 * false: the first means the turn isn't actually over, the second means
 * it ended in failure, and neither is "the turn ended with silence",
 * which is what a caller waiting on this is really asking. */
export function isEndOfTurn(event: RawRigEvent): boolean {
  if (event.type !== "session.status_idle") return false;
  const stopReason = event.stop_reason as { type?: string } | undefined;
  return stopReason?.type === "end_turn";
}
