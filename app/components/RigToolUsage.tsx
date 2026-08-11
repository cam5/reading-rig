type Status = "pending" | "success" | "error";

type Props = {
  /** The tool's own name — `web_search` / `web_fetch` (built-in, per
   * `agentConfig.ts`'s `buildToolset()`) today; `search_shelf` /
   * `get_passage` / etc. (app/rig/tools/*) once custom tools are
   * registered on the agent. */
  name: string;
  /** Which of the three tool-call event families this is —
   * `agent.tool_use` (builtin), `agent.custom_tool_use`, or
   * `agent.mcp_tool_use`. Purely a display distinction (a small label);
   * all three carry the same `name`/`input` shape. */
  kind?: "builtin" | "custom" | "mcp";
  input: Record<string, unknown>;
  status: Status;
  /** Short text pulled from the paired result event's `content` — e.g. a
   * `search_result` block's `title`, or a custom tool's plain text. Absent
   * while `status` is "pending". Real result content can carry images/
   * documents too (`agent.tool_result.content`'s block union); this
   * component only ever shows the text summary, matching the "quiet, not a
   * product" brief rather than rendering every block type inline. */
  resultSummary?: string;
};

const kindLabel: Record<NonNullable<Props["kind"]>, string> = {
  builtin: "tool",
  custom: "reading tool",
  mcp: "mcp tool",
};

/**
 * One tool call and its result as a single quiet unit — collapsed by
 * default behind a native `<details>` (no JS state needed for something
 * this secondary). Tool activity is the Rig's own bookkeeping, not part of
 * what it says, so it stays visually recessive relative to `RigMessage`:
 * small, low-emphasis, expand-on-demand.
 */
export function RigToolUsage({ name, kind = "builtin", input, status, resultSummary }: Props) {
  const statusLabel = status === "pending" ? "running…" : status === "error" ? "failed" : "done";
  const statusColorClass =
    status === "error" ? "text-[var(--color-accent-800)]" : "text-text opacity-50";

  return (
    <details className="group py-1">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] text-text opacity-60 marker:content-none">
        <span className="inline-block h-[6px] w-[6px] flex-none rounded-full bg-[var(--color-accent-300)] group-open:bg-[var(--color-accent)]" />
        <span className="uppercase tracking-wide">{kindLabel[kind]}</span>
        <span className="font-medium text-text opacity-80">{name}</span>
        <span className={statusColorClass}>{statusLabel}</span>
      </summary>
      <div className="mt-1.5 ml-3.5 flex flex-col gap-1.5 border-l border-[var(--color-divider)] pl-3 text-[11.5px]">
        <div>
          <span className="text-text opacity-45">input </span>
          <code className="text-text opacity-75">{JSON.stringify(input)}</code>
        </div>
        {resultSummary && (
          <div>
            <span className="text-text opacity-45">result </span>
            <span className="text-text opacity-75">{resultSummary}</span>
          </div>
        )}
      </div>
    </details>
  );
}
