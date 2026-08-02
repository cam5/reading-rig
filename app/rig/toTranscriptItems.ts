import type { ReferenceEvent } from "./__fixtures__/referenceSessionEvents";

export type TranscriptItem =
  | { kind: "message"; id: string; role: "user" | "agent"; text: string }
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
  | { kind: "status"; id: string; status: "running" | "terminated" | "error"; message?: string };

type ContentBlock = { type: string; text?: string; title?: string; [key: string]: unknown };

function joinText(content: unknown): string {
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
  return text ? (text.length > 140 ? `${text.slice(0, 140)}…` : text) : undefined;
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
 * `RigStatus`'s own note on why "idle" isn't shown.
 */
export function toTranscriptItems(events: ReferenceEvent[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const pendingByUseId = new Map<string, Extract<TranscriptItem, { kind: "tool" | "memory" }>>();

  for (const event of events) {
    switch (event.type) {
      case "user.message":
      case "agent.message": {
        const text = joinText(event.content);
        if (text) items.push({ kind: "message", id: event.id, role: event.type === "user.message" ? "user" : "agent", text });
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
        const toolKind = event.type === "agent.custom_tool_use" ? "custom" : event.type === "agent.mcp_tool_use" ? "mcp" : "builtin";
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
          pendingByUseId.set(event.id, item as Extract<TranscriptItem, { kind: "memory" }>);
        } else {
          const item: TranscriptItem = { kind: "tool", id: event.id, name, toolKind, input, status: "pending" };
          items.push(item);
          pendingByUseId.set(event.id, item as Extract<TranscriptItem, { kind: "tool" }>);
        }
        break;
      }
      case "agent.tool_result":
      case "agent.custom_tool_result":
      case "agent.mcp_tool_result":
      case "user.custom_tool_result":
      case "user.tool_result": {
        const useId = String(
          event.tool_use_id ?? event.custom_tool_use_id ?? event.mcp_tool_use_id ?? "",
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
        items.push({ kind: "status", id: event.id, status: "error", message: error?.message });
        break;
      }
      default:
        break;
    }
  }

  return items;
}
