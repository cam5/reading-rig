/**
 * The shape `app/rig/sessionLoop.ts` needs from "a Managed Agents session's
 * events surface" — deliberately narrower than `@anthropic-ai/sdk`'s own
 * types. Two implementations exist: `anthropicSessionSource.ts` (real
 * network glue, thin and untested beyond typecheck — there is no
 * ANTHROPIC_API_KEY in this environment) and a fake built inline in
 * sessionLoop.test.ts (a scripted sequence of events, including a
 * simulated stream drop). The loop itself only ever depends on this
 * interface, which is what makes the drop/reconnect/dedupe behavior
 * testable without a real network.
 *
 * Field names below intentionally mirror the real SDK's event shapes
 * (`agent.custom_tool_use`'s `id`/`name`/`input`, `session.status_idle`'s
 * `stop_reason`) so that mapping a real `BetaManagedAgentsStreamSessionEvents`
 * onto `RigSessionEvent` in anthropicSessionSource.ts is a pass-through, not
 * a translation.
 */

export type ToolResultContentBlock = { type: "text"; text: string };

export type CustomToolUseEvent = {
  type: "agent.custom_tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type IdleStopReason =
  | { type: "requires_action"; event_ids?: string[] }
  | { type: "end_turn" }
  | { type: "retries_exhausted" };

export type StatusIdleEvent = {
  type: "session.status_idle";
  id: string;
  stop_reason: IdleStopReason;
};

export type StatusTerminatedEvent = {
  type: "session.status_terminated";
  id: string;
};

/**
 * Every other event type the stream can emit (`agent.message`,
 * `span.model_request_start`, the echoed `user.*` events, etc.) — passed
 * through to `onEvent` for display/logging, but not otherwise inspected by
 * the loop. Kept as a loose shape (only `id` and `type` guaranteed) rather
 * than enumerating the full event union: the loop's own control flow only
 * branches on the three named event types above.
 */
export type OtherSessionEvent = {
  type: string;
  id: string;
  [key: string]: unknown;
};

export type RigSessionEvent =
  | CustomToolUseEvent
  | StatusIdleEvent
  | StatusTerminatedEvent
  | OtherSessionEvent;

/**
 * Plain `event.type === "..."` narrowing doesn't work cleanly here:
 * `OtherSessionEvent.type` is a bare `string`, so TypeScript can't prove
 * it's disjoint from any of the other members' literal `type`s and keeps
 * it in every narrowed branch — `event.name` or `event.stop_reason` would
 * type as `unknown` (from `OtherSessionEvent`'s index signature) rather
 * than the specific event's field. User-defined type guards sidestep that:
 * a `some is T` predicate asserts the narrowed type outright instead of
 * relying on structural disjointness.
 */
export function isCustomToolUseEvent(
  event: RigSessionEvent,
): event is CustomToolUseEvent {
  return event.type === "agent.custom_tool_use";
}

export function isStatusIdleEvent(
  event: RigSessionEvent,
): event is StatusIdleEvent {
  return event.type === "session.status_idle";
}

export function isStatusTerminatedEvent(
  event: RigSessionEvent,
): event is StatusTerminatedEvent {
  return event.type === "session.status_terminated";
}

export type CustomToolResultEvent = {
  type: "user.custom_tool_result";
  custom_tool_use_id: string;
  content: ToolResultContentBlock[];
  is_error: boolean;
};

export type UserMessageEvent = {
  type: "user.message";
  content: ToolResultContentBlock[];
};

export type SendableEvent = CustomToolResultEvent | UserMessageEvent;

export interface SessionEventSource {
  /**
   * Opens a live stream of events from "now" — no replay of anything that
   * happened before this call. Must be called (stream-first) before
   * `listEvents` is trusted, per the build plan: "stream-first ordering
   * (open the stream before sending)".
   */
  stream(sessionId: string): AsyncIterable<RigSessionEvent>;
  /** Full event history, oldest first — the backfill a reconnect uses to
   * cover the gap a dropped stream leaves behind. */
  listEvents(sessionId: string): Promise<RigSessionEvent[]>;
  /** Sends one or more events to the session (a batch of
   * `user.custom_tool_result`s, or a `user.message`). */
  send(sessionId: string, events: SendableEvent[]): Promise<void>;
}
