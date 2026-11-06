/**
 * Static coverage analysis for the analytics catalog in
 * `app/analytics.server.ts`: which declared events actually have an emitter,
 * which ones don't, which side (server `track()` vs. browser
 * `sendAnalyticsBeacon()`) each is emitted from, and which route modules
 * export a loader/action with no instrumentation at all.
 *
 * Pure functions over file *contents* — no filesystem, no network, no
 * PostHog key — so the parsers can be tested against fixture strings and the
 * CLI (`scripts/metricsCoverage.ts`) stays a thin walker. It reads source
 * text, not a TypeScript AST: the catalog's own conventions (one `name:
 * "..."` literal per union member, `track(` / `sendAnalyticsBeacon(` as the
 * only emit seams) are regular enough that a comment-stripping scanner is
 * enough, and it keeps this dependency-free.
 */

export type SourceFile = { path: string; content: string };

export type EventSide = "server" | "client";

export type DeclaredEvent = { name: string; side: EventSide };

export type EmitterKind = "track" | "sendAnalyticsBeacon";

export type Emitter = {
  event: string;
  file: string;
  line: number;
  kind: EmitterKind;
  /** Set when the name came from a builder function (e.g.
   * `highlightCreatedEvent(...)`) rather than a literal at the call site. */
  via?: string;
};

/** A `track(`/`sendAnalyticsBeacon(` call whose event name couldn't be
 * resolved statically. Not an error by itself, but worth a look. */
export type UnresolvedCall = { file: string; line: number; kind: EmitterKind };

export type RouteHandlerReport = {
  file: string;
  handlers: ("loader" | "action")[];
};

/**
 * Declared events that are deliberately typed-but-unemitted, each with the
 * reason. The guard test fails on any declared event that has no emitter and
 * isn't listed here — so adding an event to the union means adding its
 * emitter or an entry here, never neither.
 *
 * Empty on purpose: the analyzer's first run found an emitter for every
 * declared event (the "left typed-but-unemitted" cases the catalog's
 * comments mention were since given beacons).
 */
export const INTENTIONALLY_UNEMITTED: Readonly<Record<string, string>> = {};

/**
 * Files whose `track()` call is a relay for another emitter, not an emitter
 * itself. `analytics-beacon.tsx` forwards whatever `sendAnalyticsBeacon()`
 * sent, so counting it would double-count every client event.
 */
export const RELAY_FILES = ["app/routes/analytics-beacon.tsx"];

/**
 * Replaces comments with spaces (keeping newlines, so line numbers survive)
 * while leaving string literals intact. Doc comments in this codebase
 * mention `track()` and `name: "..."` constantly; without this they'd read
 * as call sites.
 */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") j++;
        j++;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function lineAt(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (src[i] === "\n") line++;
  return line;
}

/** Index of the bracket matching the one at `open`, skipping string
 * literals. Assumes comments are already stripped. */
function matchBracket(src: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const stack: string[] = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") j++;
        j++;
      }
      i = j;
    } else if (pairs[c]) {
      stack.push(pairs[c]);
    } else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return src.length;
}

/**
 * Event names written as `name: <expr>` in a chunk of (comment-stripped)
 * code, where `<expr>` is a string literal or a conditional over string
 * literals (`name: existingUser ? "signed_in" : "signed_up"`).
 */
function nameLiterals(code: string): string[] {
  const names: string[] = [];
  const re = /\bname\s*:\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let depth = 0;
    let end = m.index + m[0].length;
    for (; end < code.length; end++) {
      const c = code[end];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        if (depth === 0) break;
        depth--;
      } else if ((c === "," || c === ";") && depth === 0) break;
    }
    const expr = code.slice(m.index + m[0].length, end);
    for (const lit of expr.matchAll(/"([^"\\]+)"|'([^'\\]+)'/g)) {
      names.push(lit[1] ?? lit[2]);
    }
  }
  return names;
}

/** The right-hand side of `type <name> = ...;`, ending at the first `;`
 * outside any bracket (object-type members end in `;` too). */
function typeAliasBody(code: string, name: string): string | null {
  const m = new RegExp(`\\btype\\s+${name}\\s*=`).exec(code);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (c === "(" || c === "[" || c === "{" || c === "<") depth++;
    else if (c === ")" || c === "]" || c === "}" || c === ">") depth--;
    else if (c === ";" && depth === 0) return code.slice(start, i);
  }
  return code.slice(start);
}

/**
 * Every event in the `AnalyticsEvent` union, tagged `client` if it's also in
 * `ClientAnalyticsEventName` (the beacon relay's whitelist) and `server`
 * otherwise.
 */
export function parseDeclaredEvents(src: string): DeclaredEvent[] {
  const code = stripComments(src);
  const union = typeAliasBody(code, "AnalyticsEvent");
  if (union === null) {
    throw new Error("no `type AnalyticsEvent =` union found");
  }
  const client = new Set(
    [
      ...(typeAliasBody(code, "ClientAnalyticsEventName") ?? "").matchAll(
        /"([^"]+)"/g,
      ),
    ].map((m) => m[1]),
  );
  const seen = new Set<string>();
  const events: DeclaredEvent[] = [];
  for (const m of union.matchAll(/\bname\s*:\s*"([^"]+)"/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    events.push({ name: m[1], side: client.has(m[1]) ? "client" : "server" });
  }
  return events;
}

/** Plain `function foo(...)` declarations whose body builds an event, keyed
 * by name — so `track(highlightCreatedEvent(...), ...)` resolves. */
function findBuilders(code: string): Map<string, string[]> {
  const builders = new Map<string, string[]>();
  for (const m of code.matchAll(/\bfunction\s+(\w+)\s*\(/g)) {
    const paramsOpen = m.index! + m[0].length - 1;
    const paramsClose = matchBracket(code, paramsOpen);
    const bodyOpen = code.indexOf("{", paramsClose);
    if (bodyOpen === -1) continue;
    const body = code.slice(bodyOpen, matchBracket(code, bodyOpen) + 1);
    const names = nameLiterals(body);
    if (names.length > 0) builders.set(m[1], names);
  }
  return builders;
}

type Call = { kind: string; index: number; args: string };

/** Calls to the given free functions — not method calls
 * (`posthog.captureException`) and not their own declarations. */
function findCalls(code: string, fns: string[]): Call[] {
  const calls: Call[] = [];
  const re = new RegExp(`(?<![.\\w])(${fns.join("|")})\\s*\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (/\bfunction\s*$/.test(code.slice(Math.max(0, m.index - 20), m.index)))
      continue;
    const open = m.index + m[0].length - 1;
    calls.push({
      kind: m[1],
      index: m.index,
      args: code.slice(open + 1, matchBracket(code, open)),
    });
  }
  return calls;
}

export function findEmitters(files: SourceFile[]): {
  emitters: Emitter[];
  unresolved: UnresolvedCall[];
} {
  const emitters: Emitter[] = [];
  const unresolved: UnresolvedCall[] = [];
  for (const file of files) {
    if (RELAY_FILES.includes(file.path)) continue;
    const code = stripComments(file.content);
    const builders = findBuilders(code);
    for (const call of findCalls(code, ["track", "sendAnalyticsBeacon"])) {
      const kind = call.kind as EmitterKind;
      const line = lineAt(code, call.index);
      const direct = nameLiterals(call.args);
      if (direct.length > 0) {
        for (const event of direct)
          emitters.push({ event, file: file.path, line, kind });
        continue;
      }
      const via = [...call.args.matchAll(/\b(\w+)\s*\(/g)]
        .map((m) => m[1])
        .find((fn) => builders.has(fn));
      if (via) {
        for (const event of builders.get(via)!)
          emitters.push({ event, file: file.path, line, kind, via });
      } else {
        unresolved.push({ file: file.path, line, kind });
      }
    }
  }
  return { emitters, unresolved };
}

/** Whether a file calls any emit/report seam at all, comments excluded. */
export function callsInstrumentation(content: string): boolean {
  return (
    findCalls(stripComments(content), [
      "track",
      "sendAnalyticsBeacon",
      "captureException",
    ]).length > 0
  );
}

/** `~/foo/bar` or `./x` import specifiers pointing at a `handle*.server`
 * helper, resolved to repo-relative paths without an extension. */
function handlerHelperImports(routePath: string, code: string): string[] {
  const out: string[] = [];
  const dir = routePath.split("/").slice(0, -1).join("/");
  for (const m of code.matchAll(/from\s+"([^"]*\/handle\w*\.server)"/g)) {
    const spec = m[1];
    if (spec.startsWith("~/")) out.push(`app/${spec.slice(2)}`);
    else if (spec.startsWith(".")) {
      const parts = `${dir}/${spec}`.split("/");
      const resolved: string[] = [];
      for (const p of parts) {
        if (p === "." || p === "") continue;
        if (p === "..") resolved.pop();
        else resolved.push(p);
      }
      out.push(resolved.join("/"));
    }
  }
  return out;
}

/**
 * Route modules that export a `loader` or `action` but never call `track`,
 * `sendAnalyticsBeacon` or `captureException` — directly or through an
 * imported `handle*.server` helper (`handleReadAction.server.ts`).
 *
 * `allFiles` is used only to look those helpers up; pass every scanned file.
 */
export function findUninstrumentedHandlers(
  routeFiles: SourceFile[],
  allFiles: SourceFile[] = routeFiles,
): RouteHandlerReport[] {
  const byStem = new Map(
    allFiles.map((f) => [f.path.replace(/\.tsx?$/, ""), f.content]),
  );
  const out: RouteHandlerReport[] = [];
  for (const file of routeFiles) {
    const code = stripComments(file.content);
    const handlers = (["loader", "action"] as const).filter((h) =>
      new RegExp(
        `export\\s+(?:async\\s+)?(?:function\\s+${h}\\b|const\\s+${h}\\b)`,
      ).test(code),
    );
    if (handlers.length === 0) continue;
    if (callsInstrumentation(file.content)) continue;
    const viaHelper = handlerHelperImports(file.path, code).some((stem) => {
      const helper = byStem.get(stem);
      return helper !== undefined && callsInstrumentation(helper);
    });
    if (viaHelper) continue;
    out.push({ file: file.path, handlers: [...handlers] });
  }
  return out;
}

export type EventCoverage = DeclaredEvent & {
  emitters: Emitter[];
  allowlisted?: string;
};

export type CoverageReport = {
  events: EventCoverage[];
  /** Declared, never emitted, not on `INTENTIONALLY_UNEMITTED`. */
  neverEmitted: string[];
  /** Declared, never emitted, but allowlisted with a reason. */
  allowlistedUnemitted: { name: string; reason: string }[];
  /** Allowlist entries for events that do have an emitter, or no longer
   * exist — stale and worth removing. */
  staleAllowlist: string[];
  /** Emitted names missing from the union. The types should make this
   * impossible; kept as a sanity check on the parser itself. */
  undeclared: Emitter[];
  /** A client-whitelisted event fired by server `track()`, or a server
   * event fired by a browser beacon. */
  wrongSide: Emitter[];
  unresolved: UnresolvedCall[];
  uninstrumentedRoutes: RouteHandlerReport[];
  /** Share of declared events with at least one emitter, 0–100. */
  coveragePercent: number;
};

export function buildReport(input: {
  analyticsSource: string;
  files: SourceFile[];
  routeFiles: SourceFile[];
  allowlist?: Readonly<Record<string, string>>;
}): CoverageReport {
  const allowlist = input.allowlist ?? INTENTIONALLY_UNEMITTED;
  const declared = parseDeclaredEvents(input.analyticsSource);
  const { emitters, unresolved } = findEmitters(input.files);
  const declaredByName = new Map(declared.map((e) => [e.name, e]));

  const events: EventCoverage[] = declared.map((e) => ({
    ...e,
    emitters: emitters.filter((em) => em.event === e.name),
    ...(allowlist[e.name] !== undefined && { allowlisted: allowlist[e.name] }),
  }));
  const unemitted = events.filter((e) => e.emitters.length === 0);

  return {
    events,
    neverEmitted: unemitted
      .filter((e) => e.allowlisted === undefined)
      .map((e) => e.name),
    allowlistedUnemitted: unemitted
      .filter((e) => e.allowlisted !== undefined)
      .map((e) => ({ name: e.name, reason: e.allowlisted! })),
    staleAllowlist: Object.keys(allowlist).filter(
      (name) =>
        !declaredByName.has(name) || emitters.some((em) => em.event === name),
    ),
    undeclared: emitters.filter((em) => !declaredByName.has(em.event)),
    wrongSide: emitters.filter((em) => {
      const side = declaredByName.get(em.event)?.side;
      if (!side) return false;
      return em.kind === "track" ? side === "client" : side === "server";
    }),
    unresolved,
    uninstrumentedRoutes: findUninstrumentedHandlers(
      input.routeFiles,
      input.files,
    ),
    coveragePercent:
      declared.length === 0
        ? 100
        : Math.round(
            ((declared.length - unemitted.length) / declared.length) * 1000,
          ) / 10,
  };
}

const loc = (e: { file: string; line: number }) => `\`${e.file}:${e.line}\``;

export function formatMarkdown(report: CoverageReport): string {
  const out: string[] = [];
  const covered = report.events.filter((e) => e.emitters.length > 0).length;
  out.push("# Analytics coverage", "");
  out.push(
    `**${report.coveragePercent}%** of declared events have an emitter (${covered}/${report.events.length}).`,
    "",
  );
  out.push("## Events", "");
  out.push("| Event | Side | Emitters |", "| --- | --- | --- |");
  for (const e of report.events) {
    const where =
      e.emitters.length > 0
        ? e.emitters
            .map(
              (em) =>
                `${loc(em)} (${em.kind}${em.via ? ` via \`${em.via}\`` : ""})`,
            )
            .join("<br>")
        : e.allowlisted !== undefined
          ? `_none — allowlisted: ${e.allowlisted}_`
          : "**none**";
    out.push(`| \`${e.name}\` | ${e.side} | ${where} |`);
  }
  out.push("");

  const section = (title: string, items: string[], empty = "None.") => {
    out.push(`## ${title}`, "");
    out.push(...(items.length > 0 ? items.map((i) => `- ${i}`) : [empty]));
    out.push("");
  };
  section(
    "Declared but never emitted",
    report.neverEmitted.map((n) => `\`${n}\``),
  );
  section(
    "Allowlisted as intentionally unemitted",
    report.allowlistedUnemitted.map((e) => `\`${e.name}\` — ${e.reason}`),
  );
  section(
    "Stale allowlist entries",
    report.staleAllowlist.map((n) => `\`${n}\``),
  );
  section(
    "Emitted but undeclared",
    report.undeclared.map((e) => `\`${e.event}\` at ${loc(e)}`),
  );
  section(
    "Emitted from the wrong side",
    report.wrongSide.map(
      (e) =>
        `\`${e.event}\` via \`${e.kind}\` at ${loc(e)} (declared ${e.kind === "track" ? "client" : "server"})`,
    ),
  );
  section(
    "Unresolved emit calls",
    report.unresolved.map((u) => `\`${u.kind}\` at ${loc(u)}`),
  );
  section(
    "Routes with no instrumentation",
    report.uninstrumentedRoutes.map(
      (r) => `\`${r.file}\` (${r.handlers.join(", ")})`,
    ),
  );
  out.push(
    "_Thrown errors from every route are still reported via `captureException()` in `app/entry.server.tsx`'s `handleError`; the list above is routes with no event of their own._",
  );
  return out.join("\n") + "\n";
}
