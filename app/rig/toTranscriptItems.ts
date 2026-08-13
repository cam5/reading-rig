/** Loosely typed on purpose — good enough for this UI-mapping layer to read
 * a `type` and grab well-known fields off, not a runtime contract. See
 * sessionSource.ts's `RigSessionEvent` for the narrower, load-bearing type
 * the actual session loop depends on; this is the same shape, just named
 * for its role here rather than for what produces it — both the live SSE
 * stream (useRigLiveSession.ts) and the reference fixtures
 * (__fixtures__/referenceSessionEvents.ts) hand this function events in
 * this shape. */
export type RigDisplayEvent = {
  type: string;
  id: string;
  processed_at?: string;
  /** Wire-level metadata rig.tsx's SSE route stamps onto every frame (see
   * sessionLoop.ts's `onEvent`): false for an event surfaced by history
   * backfill, true for one read off the live tail. Absent on hand-authored
   * fixtures/tests, which is read the same as true — they model the live
   * path, not a resume. */
  live?: boolean;
  [key: string]: unknown;
};

export type TranscriptItem =
  | {
      kind: "message";
      id: string;
      role: "user" | "agent";
      text: string;
      streaming?: boolean;
      /** True when this item's text landed live as one buffered chunk
       * rather than being built up from real `event_delta` fragments — see
       * this function's own doc comment on why `event_deltas` is
       * best-effort. `RigMessage` reads this to decide whether to animate
       * the text in itself (only it knows the reveal policy/threshold);
       * this layer only knows *how the text arrived*, not how it should be
       * shown. Never true for `role: "user"` — the reader typed that text
       * themselves, so there's nothing to reveal. Also never true for a
       * message surfaced by history backfill (`event.live === false`) — a
       * resumed session redisplaying an old reply isn't "fresh," so it
       * must render complete, not replay the typewriter effect. */
      simulateReveal?: boolean;
      /** True for a message useRigLiveSession has constructed locally,
       * ahead of its `user.message` SSE echo — see that hook's
       * `pendingMessage`. Never true for anything toTranscriptItems itself
       * produces; this field exists purely so RigMessage can dim a message
       * that hasn't been confirmed by the server yet. */
      pending?: boolean;
    }
  | { kind: "thinking"; id: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      toolKind: "builtin" | "custom" | "mcp";
      input: Record<string, unknown>;
      status: "pending" | "success" | "error";
      resultSummary?: string;
    }
  | {
      kind: "memory";
      id: string;
      action: "read" | "write";
      path: string;
      status: "pending" | "success" | "error";
      preview?: string;
    }
  | {
      kind: "status";
      id: string;
      status: "running" | "terminated" | "error";
      message?: string;
    };

type ContentBlock = {
  type: string;
  text?: string;
  title?: string;
  [key: string]: unknown;
};

/** Exported for useRigLiveSession.ts, which needs the same "what text did
 * this event actually carry" logic to recognize its own optimistic
 * `pendingMessage` echoed back in a real `user.message` event. */
export function joinText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as ContentBlock[])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

function summarize(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const blocks = content as ContentBlock[];
  const searchResult = blocks.find((block) => block.type === "search_result");
  if (searchResult?.title) return String(searchResult.title);
  const text = joinText(content);
  return text
    ? text.length > 140
      ? `${text.slice(0, 140)}…`
      : text
    : undefined;
}

const MEMORY_PATH_PREFIX = "/mnt/memory/";

/**
 * Maps one session's raw event history onto the props these components
 * expect — the adapter layer between "what the Managed Agents API sends"
 * and "what a `RigMessage`/`RigToolUsage`/etc. needs to render," so the
 * components themselves never have to know an event's shape. Tool-use and
 * tool-result events arrive as two separate events (see sessionLoop.ts's
 * own dispatch loop, which faces the same split); this walks the list once,
 * keeping an open item per in-flight `*_use_id` to fill in when its result
 * arrives, exactly like `RigToolUsage`'s `status: "pending"` is meant for.
 *
 * `span.*` (model-request telemetry) and `session.thread_*` /
 * `session.status_idle` events are intentionally dropped — see
 * `RigStatus`'s own note on why "idle" isn't shown. `event_start` /
 * `event_delta` preview frames (see anthropicSessionSource.ts's
 * `event_deltas` opt-in) don't map to their own item — they fill in the
 * `message` item that their reconciling buffered `agent.message` will later
 * complete, so a reply's text arrives incrementally instead of all at once.
 */
export function toTranscriptItems(events: RigDisplayEvent[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const pendingByUseId = new Map<
    string,
    Extract<TranscriptItem, { kind: "tool" | "memory" }>
  >();
  // Keyed by the previewed agent.message's id (event_start's event.id, same
  // id event_delta's event_id and the reconciling buffered agent.message
  // carry) — the in-progress item those three frames all refer to.
  const streamingMessages = new Map<
    string,
    Extract<TranscriptItem, { kind: "message" }>
  >();

  for (const event of events) {
    switch (event.type) {
      case "event_start": {
        const preview = event.event as
          { type?: string; id?: string } | undefined;
        if (preview?.type === "agent.message" && preview.id) {
          const item: Extract<TranscriptItem, { kind: "message" }> = {
            kind: "message",
            id: preview.id,
            role: "agent",
            text: "",
            streaming: true,
          };
          items.push(item);
          streamingMessages.set(preview.id, item);
        }
        break;
      }
      case "event_delta": {
        const eventId = String(event.event_id ?? "");
        const streamingItem = streamingMessages.get(eventId);
        const delta = event.delta as
          | { type?: string; content?: { type?: string; text?: string } }
          | undefined;
        if (
          streamingItem &&
          delta?.type === "content_delta" &&
          delta.content?.type === "text"
        ) {
          streamingItem.text += delta.content.text ?? "";
        }
        break;
      }
      case "user.message":
      case "agent.message": {
        const text = joinText(event.content);
        const streamingItem =
          event.type === "agent.message"
            ? streamingMessages.get(event.id)
            : undefined;
        if (streamingItem) {
          // The buffered event reconciling a preview: carries the complete,
          // authoritative content — replace rather than append, in case any
          // delta frames were dropped in transit ("deltas are best-effort").
          // Whether any *did* land before this arrived is exactly what
          // simulateReveal needs: text still empty here means the preview
          // opened but nothing ever streamed into it — the same "one blob,
          // no warning" shape as skipping the preview entirely.
          const hadLiveDeltas = streamingItem.text.length > 0;
          streamingItem.text = text;
          streamingItem.streaming = false;
          streamingItem.simulateReveal = !hadLiveDeltas;
          streamingMessages.delete(event.id);
          break;
        }
        if (text) {
          items.push({
            kind: "message",
            id: event.id,
            role: event.type === "user.message" ? "user" : "agent",
            text,
            // event.live is only ever false for history backfill (see
            // RigDisplayEvent's doc comment) — never animate a message
            // that's arriving because a session was resumed, not streamed.
            simulateReveal:
              event.type === "agent.message" && event.live !== false,
          });
        }
        break;
      }
      case "agent.thinking":
        items.push({ kind: "thinking", id: event.id });
        break;
      case "agent.tool_use":
      case "agent.custom_tool_use":
      case "agent.mcp_tool_use": {
        const name = String(event.name ?? "");
        const input = (event.input as Record<string, unknown>) ?? {};
        const toolKind =
          event.type === "agent.custom_tool_use"
            ? "custom"
            : event.type === "agent.mcp_tool_use"
              ? "mcp"
              : "builtin";
        const path = typeof input.path === "string" ? input.path : undefined;

        if (path?.startsWith(MEMORY_PATH_PREFIX)) {
          const item: TranscriptItem = {
            kind: "memory",
            id: event.id,
            action: name === "read" ? "read" : "write",
            path,
            status: "pending",
          };
          items.push(item);
          pendingByUseId.set(
            event.id,
            item as Extract<TranscriptItem, { kind: "memory" }>,
          );
        } else {
          const item: TranscriptItem = {
            kind: "tool",
            id: event.id,
            name,
            toolKind,
            input,
            status: "pending",
          };
          items.push(item);
          pendingByUseId.set(
            event.id,
            item as Extract<TranscriptItem, { kind: "tool" }>,
          );
        }
        break;
      }
      case "agent.tool_result":
      case "agent.custom_tool_result":
      case "agent.mcp_tool_result":
      case "user.custom_tool_result":
      case "user.tool_result": {
        const useId = String(
          event.tool_use_id ??
            event.custom_tool_use_id ??
            event.mcp_tool_use_id ??
            "",
        );
        const pending = pendingByUseId.get(useId);
        if (!pending) break;
        const status = event.is_error ? "error" : "success";
        if (pending.kind === "tool") {
          pending.status = status;
          pending.resultSummary = summarize(event.content);
        } else {
          pending.status = status;
          pending.preview = summarize(event.content);
        }
        pendingByUseId.delete(useId);
        break;
      }
      case "session.status_running":
        items.push({ kind: "status", id: event.id, status: "running" });
        break;
      case "session.status_terminated":
        items.push({ kind: "status", id: event.id, status: "terminated" });
        break;
      case "session.error": {
        const error = event.error as { message?: string } | undefined;
        items.push({
          kind: "status",
          id: event.id,
          status: "error",
          message: error?.message,
        });
        break;
      }
      default:
        break;
    }
  }

  return items;
}
