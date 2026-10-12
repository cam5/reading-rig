/**
 * The one seam server-side code logs through.
 *
 * Same shape as `analytics.server.ts`'s `track()`: a thin wrapper we own
 * rather than `console.*` at every call site, so what a log line looks
 * like is decided once. No dependency behind it on purpose — this app's
 * logs are read with `railway logs` and a grep (see RUNBOOK.md's "Reading
 * the logs"), and plain `console` output is already what Railway collects.
 * A real logging library can replace the body of `write()` later without
 * touching a call site.
 *
 * Every line is `[scope] message key=value ...`, with the thrown error (if
 * any) passed to `console` last and untouched, so its stack trace survives
 * instead of being flattened into a string.
 *
 * And one thing it should never be handed: the text of a highlight, a note
 * or a Rig message, an API token or its hash, a session cookie, or a magic
 * link. Fields are for ids, counts and sizes — enough to find the request,
 * never the reader's own words or a credential. Same rule
 * `analytics.server.ts` holds its events to.
 */

/**
 * `error` is the one reserved key: whatever was caught, passed through to
 * `console` as its own argument rather than rendered into the line.
 * Everything else becomes a `key=value` pair; `undefined` values are
 * dropped, so a call site can pass an optional id without guarding it.
 */
export type LogFields = Record<string, unknown> & { error?: unknown };

type LogLevel = "info" | "warn" | "error";

/** `info` goes to `console.log`, matching what these call sites used
 * before there was a wrapper — Railway reads stdout and stderr both. */
const CONSOLE_METHOD = {
  info: "log",
  warn: "warn",
  error: "error",
} as const satisfies Record<LogLevel, keyof Console>;

/** Bare when it's safe to (`workId=abc123`), JSON-quoted when it isn't
 * (`title="A Tale of Two Cities"`), so a value with a space in it can't be
 * misread as two fields. */
function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return /^[^\s"=]+$/.test(value) ? value : JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value) ?? String(value);
}

function write(
  level: LogLevel,
  scope: string,
  message: string,
  fields: LogFields = {},
): void {
  const { error, ...rest } = fields;
  const pairs = Object.entries(rest)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`);
  const line = [`[${scope}] ${message}`, ...pairs].join(" ");

  if (error === undefined) console[CONSOLE_METHOD[level]](line);
  else console[CONSOLE_METHOD[level]](line, error);
}

export const log = {
  /** Something expected happened that's still worth a line. */
  info: (scope: string, message: string, fields?: LogFields) =>
    write("info", scope, message, fields),
  /** Something went wrong and was recovered from — a retry, a fallback, a
   * degraded response. Nobody needs to act unless it keeps happening. */
  warn: (scope: string, message: string, fields?: LogFields) =>
    write("warn", scope, message, fields),
  /** Something failed and the caller got an error, or lost data, for it. */
  error: (scope: string, message: string, fields?: LogFields) =>
    write("error", scope, message, fields),
};
