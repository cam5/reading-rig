import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INTENTIONALLY_UNEMITTED,
  buildReport,
  findEmitters,
  findUninstrumentedHandlers,
  parseDeclaredEvents,
  stripComments,
  type SourceFile,
} from "./metricsCoverage";

const ANALYTICS = `
/** Mentions name: "comment_only" and track() in a comment. */
export type AnalyticsEvent =
  /** first */
  | { name: "alpha"; workId: string; nested: { a: number; b: string } }
  | {
      name: "beta";
      count: number;
    }
  | { name: "gamma"; ok: boolean };

export type AnalyticsEventName = AnalyticsEvent["name"];

export type ClientAnalyticsEventName =
  "gamma";
`;

describe("stripComments", () => {
  it("blanks comments but keeps strings and line numbers", () => {
    const src = `a // x\n/* y\n z */ "http://not-a-comment"`;
    const out = stripComments(src);
    expect(out.split("\n")).toHaveLength(3);
    expect(out).not.toContain("x");
    expect(out).toContain('"http://not-a-comment"');
  });
});

describe("parseDeclaredEvents", () => {
  it("reads every union member and tags client-whitelisted ones", () => {
    expect(parseDeclaredEvents(ANALYTICS)).toEqual([
      { name: "alpha", side: "server" },
      { name: "beta", side: "server" },
      { name: "gamma", side: "client" },
    ]);
  });

  it("throws when there's no union to read", () => {
    expect(() => parseDeclaredEvents("export const x = 1;")).toThrow();
  });
});

describe("findEmitters", () => {
  it("finds a track() call spread across lines, at the call's line", () => {
    const { emitters } = findEmitters([
      {
        path: "app/routes/x.tsx",
        content: `// track({ name: "commented" })\nexport async function loader() {\n  await track(\n    {\n      name: "alpha",\n      workId,\n    },\n    ctx,\n  );\n}`,
      },
    ]);
    expect(emitters).toEqual([
      { event: "alpha", file: "app/routes/x.tsx", line: 3, kind: "track" },
    ]);
  });

  it("resolves both arms of a conditional name", () => {
    const { emitters } = findEmitters([
      {
        path: "a.ts",
        content: `track({ name: isNew ? "beta" : "alpha", x: 1 }, ctx);`,
      },
    ]);
    expect(emitters.map((e) => e.event)).toEqual(["beta", "alpha"]);
  });

  it("resolves an event built by a same-file function", () => {
    const { emitters, unresolved } = findEmitters([
      {
        path: "a.server.ts",
        content: `function betaEvent(n: number): AnalyticsEvent {\n  return { name: "beta", count: n };\n}\nawait track(betaEvent(1), ctx);`,
      },
    ]);
    expect(unresolved).toEqual([]);
    expect(emitters).toEqual([
      {
        event: "beta",
        file: "a.server.ts",
        line: 4,
        kind: "track",
        via: "betaEvent",
      },
    ]);
  });

  it("records beacon calls as their own kind", () => {
    const { emitters } = findEmitters([
      {
        path: "c.tsx",
        content: `sendAnalyticsBeacon({ name: "gamma", ok: true });`,
      },
    ]);
    expect(emitters[0]).toMatchObject({
      event: "gamma",
      kind: "sendAnalyticsBeacon",
    });
  });

  it("skips the beacon relay route and the seams' own definitions", () => {
    const { emitters, unresolved } = findEmitters([
      {
        path: "app/routes/analytics-beacon.tsx",
        content: `await track(event as ClientAnalyticsEvent, ctx);`,
      },
      {
        path: "app/analytics.server.ts",
        content: `export async function track(event: AnalyticsEvent) {}\nposthog.track({ name: "nope" });`,
      },
    ]);
    expect(emitters).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  it("reports a call whose name can't be resolved", () => {
    const { unresolved } = findEmitters([
      { path: "d.ts", content: `track(someEvent, ctx);` },
    ]);
    expect(unresolved).toEqual([{ file: "d.ts", line: 1, kind: "track" }]);
  });
});

describe("findUninstrumentedHandlers", () => {
  const helper: SourceFile = {
    path: "app/domain/reading/handleReadAction.server.ts",
    content: `export async function handleReadAction() { await track({ name: "beta" }, c); }`,
  };
  const routes: SourceFile[] = [
    {
      path: "app/routes/healthz.tsx",
      content: `// track() someday\nexport function loader() { return new Response("ok"); }`,
    },
    {
      path: "app/routes/read.tsx",
      content: `export const loader = async () => { await track({ name: "alpha" }, c); };`,
    },
    {
      path: "app/routes/api.v1.read.tsx",
      content: `import { handleReadAction } from "~/domain/reading/handleReadAction.server";\nexport async function action() { return handleReadAction(); }`,
    },
    {
      path: "app/routes/auth.logout.tsx",
      content: `export async function loader() {}\nexport async function action() {}`,
    },
    {
      path: "app/routes/page.tsx",
      content: `export default function Page() { return null; }`,
    },
  ];

  it("flags only handler-exporting routes with no emit or report call", () => {
    expect(findUninstrumentedHandlers(routes, [...routes, helper])).toEqual([
      { file: "app/routes/healthz.tsx", handlers: ["loader"] },
      { file: "app/routes/auth.logout.tsx", handlers: ["loader", "action"] },
    ]);
  });
});

describe("buildReport", () => {
  it("separates covered, unemitted, allowlisted, stale, undeclared and wrong-side", () => {
    const report = buildReport({
      analyticsSource: ANALYTICS,
      files: [
        {
          path: "s.server.ts",
          content: `track({ name: "alpha" }, c); track({ name: "gamma" }, c); track({ name: "zeta" }, c);`,
        },
      ],
      routeFiles: [],
      allowlist: { beta: "typed ahead of its emitter", alpha: "stale" },
    });
    expect(report.neverEmitted).toEqual([]);
    expect(report.allowlistedUnemitted).toEqual([
      { name: "beta", reason: "typed ahead of its emitter" },
    ]);
    expect(report.staleAllowlist).toEqual(["alpha"]);
    expect(report.undeclared.map((e) => e.event)).toEqual(["zeta"]);
    expect(report.wrongSide.map((e) => e.event)).toEqual(["gamma"]);
    expect(report.coveragePercent).toBe(66.7);
  });
});

// The guard: runs against the real repo, so a new AnalyticsEvent with no
// emitter (and no reasoned INTENTIONALLY_UNEMITTED entry) fails `npm test`.
describe("this repo's analytics catalog", () => {
  const root = join(import.meta.dirname, "../..");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.name.startsWith(".") || e.name === "+types") return [];
      const p = join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return /\.tsx?$/.test(e.name) && !/\.(test|stories)\.tsx?$/.test(e.name)
        ? [p]
        : [];
    });
  const files = [...walk(join(root, "app")), ...walk(join(root, "scripts"))]
    .map((p) => ({
      path: relative(root, p).split("\\").join("/"),
      content: readFileSync(p, "utf8"),
    }))
    .filter((f) => !f.path.includes("metricsCoverage"));
  const report = buildReport({
    analyticsSource: readFileSync(
      join(root, "app/analytics.server.ts"),
      "utf8",
    ),
    files,
    routeFiles: files.filter((f) => /^app\/routes\/[^/]+\.tsx?$/.test(f.path)),
  });

  it("parses a non-trivial catalog", () => {
    expect(report.events.length).toBeGreaterThan(5);
  });

  it("has an emitter or a reasoned allowlist entry for every declared event", () => {
    expect(report.neverEmitted).toEqual([]);
  });

  it("has no stale allowlist entries", () => {
    expect(report.staleAllowlist).toEqual([]);
  });

  it("gives every allowlist entry a reason", () => {
    for (const reason of Object.values(INTENTIONALLY_UNEMITTED)) {
      expect(reason.trim()).not.toBe("");
    }
  });

  it("emits every event only from the side it's declared for", () => {
    expect(report.wrongSide).toEqual([]);
    expect(report.undeclared).toEqual([]);
    expect(report.unresolved).toEqual([]);
  });
});
