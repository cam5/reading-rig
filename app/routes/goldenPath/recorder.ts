import type { RequestHandler } from "react-router";
import type { CookieJar } from "./harness";
import type { Scenario, Step } from "./scenarios";

/**
 * Runs a Scenario (scenarios.ts) through the built server's request
 * handler and returns a *normalised* recording of it — the thing that
 * gets committed under ./recordings/ and compared on every later run.
 *
 * "Normalised" is the whole job. A raw response is full of things that
 * differ on every run without anything having changed: cuids, createdAt
 * timestamps, the signed session cookie, formatted dates. A recording
 * that held any of them would fail constantly and teach everyone to
 * re-record without reading the diff. So a step records only:
 *
 *   - status, the redirect Location, the content type, and whether a
 *     cookie was set or cleared (never its value);
 *   - for JSON, the body's *shape* — keys, value types, array lengths —
 *     plus the literal value at the few dot-paths the step names;
 *   - for HTML, the <title> and whether each named landmark is present.
 *
 * Deliberately shape-level: what a field *contains* is the zod/OpenAPI
 * layer's job and the domain tests'. This catches the other class of
 * break — a route that stopped redirecting, a key that vanished from a
 * response, a page that renders without the thing it's for.
 */

export type JsonShape =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | { array: number; of?: JsonShape | JsonShape[] }
  | { [key: string]: JsonShape };

export type RecordedStep = {
  label: string;
  method: string;
  path: string;
  status: number;
  location?: string;
  contentType: string | null;
  cookie: "set" | "cleared" | "none";
  json?: { shape: JsonShape; literals?: Record<string, unknown> };
  html?: { title: string | null; landmarks?: Record<string, boolean> };
};

export type Recording = { scenario: string; steps: RecordedStep[] };

/** What the test asserts on directly, alongside the recording. */
export type StepResult = {
  step: Step;
  status: number;
  missingLandmarks: string[];
};

/** Values captured from earlier steps, shared across the whole journey. */
export type Captures = Map<string, string>;

// Prisma's `@default(cuid())` — "c" plus 24 base-36 characters.
const CUID = /\bc[a-z0-9]{24}\b/g;
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
const TOKEN_PARAM = /\btoken=[^&\s]+/g;
// Vite's content hash, e.g. /assets/read-BxK3f9aQ.js.
const ASSET_HASH = /(\/assets\/[\w.]+)-[\w-]{8}(\.\w+)/g;

/**
 * Replaces everything run-specific in a string with a stable placeholder.
 * Ids are numbered in order of first appearance (`<id:1>`, `<id:2>`), so
 * a recording still shows that two steps refer to the *same* id without
 * saying what it was.
 */
function createNormaliser() {
  const ids = new Map<string, number>();
  return (value: string): string =>
    value
      .replace(TOKEN_PARAM, "token=<token>")
      .replace(ASSET_HASH, "$1-<hash>$2")
      .replace(ISO_TIMESTAMP, "<ts>")
      .replace(CUID, (id) => {
        if (!ids.has(id)) ids.set(id, ids.size + 1);
        return `<id:${ids.get(id)}>`;
      });
}

function shapeOf(value: unknown): JsonShape {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    // One shape per *distinct* element shape, not per element — a
    // hundred paragraphs that all look alike are one line of recording,
    // and an array whose elements disagree still shows every variant.
    const distinct = new Map<string, JsonShape>();
    for (const element of value) {
      const shape = shapeOf(element);
      distinct.set(JSON.stringify(shape), shape);
    }
    const shapes = [...distinct.values()];
    if (shapes.length === 0) return { array: 0 };
    return {
      array: value.length,
      of: shapes.length === 1 ? shapes[0] : shapes,
    };
  }
  if (typeof value === "object") {
    // Sorted, so key order in a response is never a diff.
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, shapeOf(child)]),
    );
  }
  return typeof value as "string" | "number" | "boolean";
}

function pick(body: unknown, path: string): unknown {
  let current = body;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function resolvePath(step: Step, captures: Captures): string {
  return step.path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = captures.get(name);
    if (value === undefined) {
      throw new Error(
        `"${step.label}" needs {${name}}, which no earlier step captured`,
      );
    }
    return value;
  });
}

function buildRequest(step: Step, path: string, jar: CookieJar): Request {
  const headers = new Headers(step.headers);
  const cookie = jar.header();
  if (cookie) headers.set("Cookie", cookie);

  let body: FormData | undefined;
  if (step.form) {
    body = new FormData();
    for (const [name, value] of Object.entries(step.form)) {
      body.set(name, value);
    }
  }
  return new Request(`http://localhost${path}`, {
    method: step.method,
    headers,
    body,
  });
}

export async function recordScenario(
  scenario: Scenario,
  handler: RequestHandler,
  jar: CookieJar,
  captures: Captures,
): Promise<{ recording: Recording; results: StepResult[] }> {
  // Per scenario, not per journey: each recording file then numbers its
  // own ids from 1, and a step added to an earlier scenario can't
  // renumber every later file.
  const normalise = createNormaliser();
  const steps: RecordedStep[] = [];
  const results: StepResult[] = [];

  for (const step of scenario.steps) {
    const path = resolvePath(step, captures);
    const response = await handler(buildRequest(step, path, jar));
    const cookie = jar.absorb(response);

    const location = response.headers.get("Location");
    const contentType =
      response.headers.get("Content-Type")?.split(";")[0].trim() ?? null;
    const recorded: RecordedStep = {
      label: step.label,
      method: step.method,
      path: normalise(path),
      status: response.status,
      ...(location ? { location: normalise(location) } : {}),
      contentType,
      cookie,
    };
    const missingLandmarks: string[] = [];

    if (contentType === "application/json") {
      const body: unknown = await response.json();
      for (const [name, bodyPath] of Object.entries(step.capture ?? {})) {
        const value = pick(body, bodyPath);
        if (typeof value !== "string") {
          throw new Error(
            `"${step.label}" could not capture {${name}} from ${bodyPath}`,
          );
        }
        captures.set(name, value);
      }
      const literals = step.literals?.map((bodyPath) => {
        const value = pick(body, bodyPath);
        return [
          bodyPath,
          // `undefined` would silently vanish from the JSON file; a
          // literal the step asked for and didn't get should be visible.
          value === undefined
            ? "<missing>"
            : typeof value === "string"
              ? normalise(value)
              : value,
        ];
      });
      recorded.json = {
        shape: shapeOf(body),
        ...(literals ? { literals: Object.fromEntries(literals) } : {}),
      };
    } else if (contentType === "text/html") {
      const html = await response.text();
      const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? null;
      const landmarks = step.landmarks?.map((landmark) => {
        const present = html.includes(landmark);
        if (!present) missingLandmarks.push(landmark);
        return [landmark, present];
      });
      recorded.html = {
        title: title === null ? null : normalise(title),
        ...(landmarks ? { landmarks: Object.fromEntries(landmarks) } : {}),
      };
    }

    steps.push(recorded);
    results.push({ step, status: response.status, missingLandmarks });
  }

  return { recording: { scenario: scenario.name, steps }, results };
}

/** The exact bytes of a recording file. */
export function serialiseRecording(recording: Recording): string {
  return `${JSON.stringify(recording, null, 2)}\n`;
}
