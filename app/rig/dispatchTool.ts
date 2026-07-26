import type { PrismaClient } from "../../generated/prisma/client";
import { getPassage } from "./tools/getPassage";
import { getSourceExcerpt } from "./tools/getSourceExcerpt";
import { getSurrounding } from "./tools/getSurrounding";
import { listMyNotes } from "./tools/listMyNotes";
import { listThreads } from "./tools/listThreads";
import { searchShelf } from "./tools/searchShelf";
import { fetchBookmarkGlobalOrdinal } from "./tools/shared";

/**
 * The one place an `agent.custom_tool_use` event turns into a call against
 * #25's Prisma handlers. Transport-agnostic on purpose — the same
 * discipline the build plan states for `app/rig/tools/*.ts` itself
 * ("nothing in them knows which transport called it"): this function
 * doesn't import anything from `@anthropic-ai/sdk` or know it's being
 * driven by an SSE loop. It takes a tool name and a plain input bag and
 * returns a plain result; app/rig/sessionLoop.ts is the only thing that
 * wraps that result into a `user.custom_tool_result` event.
 *
 * userId and workId always come from the caller's session context
 * (ultimately the RigSession row), never from the model's own tool-call
 * input — the reading API is scoped to one (user, work) RigSession, and
 * the agent has no way to ask for a different user's shelf even if a tool
 * call's `input` claimed one.
 */
export type DispatchToolContext = {
  db: PrismaClient;
  userId: string;
  workId: string;
};

export type ToolDispatchOutcome = {
  isError: boolean;
  /**
   * Plain text — JSON for a successful structured result, a short prose
   * explanation for an error or an empty/not-found result. Deliberately
   * not `unknown` + a serializer pushed onto the caller: every branch below
   * decides for itself what's worth telling the model, the same way a real
   * tool's human-readable error message would.
   */
  text: string;
};

const NOT_FOUND_MESSAGE =
  "No such passage — it doesn't exist, belongs to another book, or lies past your bookmark.";

function ok(value: unknown): ToolDispatchOutcome {
  return { isError: false, text: JSON.stringify(value) };
}

function err(message: string): ToolDispatchOutcome {
  return { isError: true, text: message };
}

function asInputObject(rawInput: unknown): Record<string, unknown> {
  return rawInput !== null && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {};
}

function readString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

/** Missing/non-numeric counts fall back to 0 rather than erroring — a tool
 * call that omits `before`/`after` is asking for just the target paragraph,
 * not making a malformed request. */
function readCount(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

/**
 * Dispatches one `agent.custom_tool_use` call by name. Never throws — an
 * unknown tool name, a missing required field, or a handler that itself
 * throws (get_source_excerpt, today) all come back as `{ isError: true }`,
 * because a malformed or not-yet-buildable tool call is something the
 * agent should be told about and reason past, not something that should
 * take the whole session down with it.
 */
export async function dispatchTool(
  toolName: string,
  rawInput: unknown,
  ctx: DispatchToolContext,
): Promise<ToolDispatchOutcome> {
  const input = asInputObject(rawInput);
  const { db, userId, workId } = ctx;

  switch (toolName) {
    case "get_passage": {
      const paragraphId = readString(input, "paragraphId");
      if (!paragraphId) return err("get_passage requires a paragraphId.");
      const result = await getPassage(db, { userId, paragraphId });
      return result ? ok(result) : err(NOT_FOUND_MESSAGE);
    }

    case "get_surrounding": {
      const paragraphId = readString(input, "paragraphId");
      if (!paragraphId) return err("get_surrounding requires a paragraphId.");
      const before = readCount(input, "before");
      const after = readCount(input, "after");
      const result = await getSurrounding(db, { userId, paragraphId, before, after });
      return result ? ok(result) : err(NOT_FOUND_MESSAGE);
    }

    case "search_shelf": {
      const query = readString(input, "query");
      if (!query) return err("search_shelf requires a query.");
      // Bookmark-bounded per the build plan's "nothing past your bookmark"
      // invariant — resolved here, from the session's own (user, work),
      // never accepted as a tool-call argument the model could set itself.
      const bookmarkGlobalOrdinal = await fetchBookmarkGlobalOrdinal(db, userId, workId);
      const result = await searchShelf(db, { userId, workId, query, bookmarkGlobalOrdinal });
      return ok(result);
    }

    case "list_my_notes": {
      // Omitted workId is deliberately passed through as undefined, not
      // defaulted to the session's own work — listMyNotes' documented
      // "whole shelf" query is what the Connect posture needs to draw a
      // line to another book on the reader's shelf.
      const requestedWorkId = readString(input, "workId");
      const result = await listMyNotes(db, { userId, workId: requestedWorkId });
      return ok(result);
    }

    case "get_source_excerpt": {
      const sourceId = readString(input, "sourceId");
      if (!sourceId) return err("get_source_excerpt requires a sourceId.");
      try {
        const result = await getSourceExcerpt(db, { userId, sourceId, query: readString(input, "query") });
        return ok(result);
      } catch (error) {
        // Not implemented until M4's #23 — see getSourceExcerpt.ts. Comes
        // back as an ordinary tool error, not a crash: the agent should
        // hear "not available yet", not take the session down with it.
        return err(error instanceof Error ? error.message : String(error));
      }
    }

    case "list_threads": {
      const result = await listThreads(db, { userId });
      return ok(result);
    }

    default:
      return err(`Unknown tool: ${toolName}`);
  }
}
