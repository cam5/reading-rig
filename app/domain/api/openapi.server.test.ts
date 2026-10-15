import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import routes from "../../routes";
import { buildOpenApiDocument } from "./openapi.server";

/**
 * Contract checks for the /api/v1 OpenAPI document — the thing the iOS
 * client's swift-openapi-generator actually reads (via the
 * ios/Sources/ReadingRigKit/openapi.json symlink to openapi/api-v1.json).
 *
 * apiV1.smoke.test.ts proves the routes answer; nothing else proved the
 * committed spec still describes them. A zod schema edit or a new route
 * without a `npm run generate:openapi` used to leave the Swift client's
 * spec silently stale. These tests catch that, plus the route ↔ path ↔
 * method drift a hand-maintained paths table invites.
 *
 * Route modules are read as text, never imported: they pull in
 * db.server.ts, whose DATABASE_URL singleton has no business loading in a
 * pure test run (see apiV1.smoke.test.ts's own comment on it).
 */

const ROOT = path.join(import.meta.dirname, "..", "..", "..");
const SPEC_FILE = path.join(ROOT, "openapi", "api-v1.json");

type Operation = {
  operationId?: string;
  requestBody?: unknown;
  responses: Record<string, unknown>;
};
type PathItem = Partial<Record<"get" | "post", Operation>>;

const doc = buildOpenApiDocument() as {
  paths: Record<string, PathItem>;
  components: { schemas: Record<string, unknown> };
};

// Not part of the documented surface — it *is* the document.
const UNDOCUMENTED = new Set(["api/v1/openapi.json"]);

// Every splat in routes.ts today is a Work id — see workIdParam's own
// comment in openapi.server.ts on why one {workId} stands in for it.
function toOpenApiPath(routePath: string): string {
  return (
    "/" +
    routePath
      .split("/")
      .map((segment) => {
        if (segment === "*") return "{workId}";
        if (segment.startsWith(":")) return `{${segment.slice(1)}}`;
        return segment;
      })
      .join("/")
  );
}

const apiRoutes = routes
  .filter(
    (r) => r.path?.startsWith("api/v1/") && !UNDOCUMENTED.has(r.path ?? ""),
  )
  .map((r) => {
    const source = readFileSync(path.join(ROOT, "app", r.file), "utf8");
    return { path: toOpenApiPath(r.path!), file: r.file, source };
  });

function exportsFunction(source: string, name: "loader" | "action"): boolean {
  return new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`).test(
    source,
  );
}

function operations(): [string, string, Operation][] {
  return Object.entries(doc.paths).flatMap(([p, item]) =>
    (["get", "post"] as const)
      .filter((m) => item[m])
      .map((m): [string, string, Operation] => [p, m, item[m]!]),
  );
}

function collectRefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") out.push(value);
      else collectRefs(value, out);
    }
  }
  return out;
}

describe("openapi/api-v1.json", () => {
  it("matches buildOpenApiDocument() — run `npm run generate:openapi` if not", () => {
    // Parsed, not byte-compared: the committed file is Prettier-formatted,
    // which reflows short arrays JSON.stringify spreads across lines.
    const committed = JSON.parse(readFileSync(SPEC_FILE, "utf8"));
    expect(
      committed,
      "openapi/api-v1.json is stale — run `npm run generate:openapi && npx prettier --write openapi/api-v1.json`",
    ).toEqual(doc);
  });
});

describe("buildOpenApiDocument() vs. /api/v1 routes", () => {
  it("documents exactly the api/v1 routes in routes.ts", () => {
    expect(apiRoutes.map((r) => r.path).sort()).toEqual(
      Object.keys(doc.paths).sort(),
    );
  });

  it.each(apiRoutes.map((r) => [r.path, r] as const))(
    "%s documents get/post iff its module exports loader/action",
    (p, route) => {
      const item = doc.paths[p];
      expect(Boolean(item.get), `${route.file} loader vs. get`).toBe(
        exportsFunction(route.source, "loader"),
      );
      expect(Boolean(item.post), `${route.file} action vs. post`).toBe(
        exportsFunction(route.source, "action"),
      );
    },
  );

  it.each(apiRoutes.map((r) => [r.path, r] as const))(
    "%s authenticates via requireApiUser, so documenting 401 is honest",
    (_p, route) => {
      expect(route.source).toMatch(/requireApiUser(Id)?\(/);
    },
  );

  it("documents 401 on every operation", () => {
    for (const [p, m, op] of operations()) {
      expect(op.responses, `${m.toUpperCase()} ${p}`).toHaveProperty("401");
    }
  });

  it("documents 400 on every operation with a request body", () => {
    for (const [p, m, op] of operations()) {
      if (op.requestBody) {
        expect(op.responses, `${m.toUpperCase()} ${p}`).toHaveProperty("400");
      }
    }
  });

  it("documents 400 for every route that can fail a required-param schema", () => {
    // GET /read and GET /commonplace also call parseOrBadRequest, but on
    // all-nullable query schemas that can't fail — so no 400 there. A
    // route's operation documents 400 iff it has a required parameter or
    // a request body; either way it must actually call parseOrBadRequest.
    for (const [p, m, op] of operations()) {
      const params = (op as { parameters?: { required?: boolean }[] })
        .parameters;
      const canFail =
        Boolean(op.requestBody) || Boolean(params?.some((x) => x.required));
      expect("400" in op.responses, `${m.toUpperCase()} ${p}`).toBe(canFail);
      if (canFail) {
        const route = apiRoutes.find((r) => r.path === p)!;
        expect(route.source, route.file).toMatch(/parseOrBadRequest\(/);
      }
    }
  });

  it("gives every operation a unique operationId", () => {
    const ids = operations().map(([, , op]) => op.operationId);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("buildOpenApiDocument() is well-formed for swift-openapi-generator", () => {
  it("resolves every $ref to a components.schemas entry", () => {
    const refs = collectRefs(doc.paths);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref).toMatch(/^#\/components\/schemas\//);
      expect(doc.components.schemas).toHaveProperty(
        ref.replace("#/components/schemas/", ""),
      );
    }
  });

  it("only maps discriminator values to members of the same oneOf", () => {
    const body = doc.paths["/api/v1/read/{workId}"].post!.requestBody as {
      content: Record<
        string,
        {
          schema: {
            oneOf: { $ref: string }[];
            discriminator: { mapping: Record<string, string> };
          };
        }
      >;
    };
    for (const { schema } of Object.values(body.content)) {
      const members = schema.oneOf.map((s) => s.$ref);
      expect(Object.values(schema.discriminator.mapping).sort()).toEqual(
        [...members].sort(),
      );
    }
  });
});
