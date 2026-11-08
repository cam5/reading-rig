import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findBreakingChanges,
  hasBreakingChangeTrailer,
  resolveLocalRefs,
  type BreakingChangeKind,
} from "./openapiCompat.server";

type Json = Record<string, unknown>;

// A small but realistic base: one GET with a closed response object, one
// POST with a $ref'd oneOf request body, shared security — the same
// building blocks openapi/api-v1.json uses.
function baseDoc(): Json {
  return {
    openapi: "3.0.3",
    info: { title: "t", version: "1" },
    security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    components: {
      securitySchemes: {
        cookieAuth: { type: "apiKey", in: "cookie", name: "__rig_session" },
        bearerAuth: { type: "http", scheme: "bearer" },
      },
      schemas: {
        HighlightAction: {
          type: "object",
          properties: {
            intent: { type: "string", enum: ["highlight"] },
            spans: { type: "string", maxLength: 2000 },
            offset: { type: "number" },
            note: { type: "string", nullable: true },
            color: { type: "string", enum: ["yellow", "green"] },
          },
          required: ["intent", "spans"],
        },
        BookmarkAction: {
          type: "object",
          properties: {
            intent: { type: "string", enum: ["bookmark"] },
            paragraphId: { type: "string" },
          },
          required: ["intent", "paragraphId"],
        },
      },
    },
    paths: {
      "/api/v1/home": {
        get: {
          operationId: "getHome",
          parameters: [
            {
              name: "sort",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["title", "recent"] },
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer" },
            },
          ],
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      userId: { type: "string" },
                      score: { type: "number" },
                      suggestion: {
                        oneOf: [
                          {
                            type: "object",
                            properties: {
                              kind: { type: "string", enum: ["paragraph"] },
                            },
                            required: ["kind"],
                          },
                          {
                            type: "object",
                            properties: {
                              kind: { type: "string", enum: ["note"] },
                            },
                            required: ["kind"],
                          },
                        ],
                      },
                      role: { type: "string", enum: ["hand", "rig"] },
                      works: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            author: { type: "string", nullable: true },
                            createdAt: { type: "string", format: "date-time" },
                            count: { type: "integer" },
                          },
                          required: ["id", "author"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["userId", "role", "works"],
                    additionalProperties: false,
                  },
                },
              },
            },
            "401": { description: "unauthorized" },
          },
        },
      },
      "/api/v1/read/{workId}": {
        parameters: [
          {
            name: "workId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        post: {
          operationId: "postReadAction",
          requestBody: {
            required: true,
            content: {
              "application/x-www-form-urlencoded": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/HighlightAction" },
                    { $ref: "#/components/schemas/BookmarkAction" },
                  ],
                },
              },
            },
          },
          responses: { "200": { description: "ok" } },
        },
      },
    },
  };
}

/** Clone the base and apply `mutate` to the clone. */
function headFrom(mutate: (doc: any) => void): Json {
  const doc = structuredClone(baseDoc());
  mutate(doc);
  return doc;
}

function kinds(head: Json): BreakingChangeKind[] {
  return findBreakingChanges(baseDoc(), head).map((f) => f.kind);
}

const home200 = (doc: any) =>
  doc.paths["/api/v1/home"].get.responses["200"].content["application/json"]
    .schema;
const workItem = (doc: any) => home200(doc).properties.works.items;
const highlight = (doc: any) => doc.components.schemas.HighlightAction;

describe("findBreakingChanges", () => {
  it("finds nothing when the documents are identical", () => {
    expect(findBreakingChanges(baseDoc(), baseDoc())).toEqual([]);
  });

  it("finds nothing comparing the committed openapi/api-v1.json with itself", () => {
    const spec = JSON.parse(
      readFileSync(
        path.join(import.meta.dirname, "../../../openapi/api-v1.json"),
        "utf8",
      ),
    );
    expect(findBreakingChanges(spec, structuredClone(spec))).toEqual([]);
  });

  describe("breaking", () => {
    const cases: Array<[string, (doc: any) => void, BreakingChangeKind]> = [
      ["a removed path", (d) => delete d.paths["/api/v1/home"], "removed-path"],
      [
        "a removed method",
        (d) => {
          d.paths["/api/v1/read/{workId}"].get = d.paths["/api/v1/home"].get;
          delete d.paths["/api/v1/read/{workId}"].post;
        },
        "removed-method",
      ],
      [
        "a renamed operationId",
        (d) => (d.paths["/api/v1/home"].get.operationId = "listShelf"),
        "operation-id-changed",
      ],
      [
        "a removed response status",
        (d) => delete d.paths["/api/v1/home"].get.responses["401"],
        "removed-response-status",
      ],
      [
        "a removed response media type",
        (d) => {
          const r = d.paths["/api/v1/home"].get.responses["200"];
          r.content = { "text/plain": r.content["application/json"] };
        },
        "removed-response-media-type",
      ],
      [
        "a removed response property",
        (d) => delete home200(d).properties.userId,
        "removed-response-property",
      ],
      [
        "a removed nested response property",
        (d) => delete workItem(d).properties.author,
        "removed-response-property",
      ],
      [
        "a required response property becoming optional",
        (d) => (home200(d).required = ["role", "works"]),
        "response-property-became-optional",
      ],
      [
        "a response property becoming nullable",
        (d) => (home200(d).properties.userId.nullable = true),
        "response-became-nullable",
      ],
      [
        "a response property changing type",
        (d) => (home200(d).properties.userId = { type: "integer" }),
        "response-type-changed",
      ],
      [
        "a response enum losing a value",
        (d) => (home200(d).properties.role.enum = ["hand"]),
        "response-enum-lost-value",
      ],
      [
        "a response enum gaining a value (frozen Swift enums)",
        (d) => (home200(d).properties.role.enum = ["hand", "rig", "guest"]),
        "response-enum-gained-value",
      ],
      [
        "a new property on an additionalProperties:false response object",
        (d) => (workItem(d).properties.title = { type: "string" }),
        "added-response-property-closed-object",
      ],
      [
        "a new required query parameter",
        (d) =>
          d.paths["/api/v1/home"].get.parameters.push({
            name: "page",
            in: "query",
            required: true,
            schema: { type: "integer" },
          }),
        "new-required-parameter",
      ],
      [
        "an optional parameter becoming required",
        (d) => (d.paths["/api/v1/home"].get.parameters[0].required = true),
        "parameter-became-required",
      ],
      [
        "a request parameter enum losing a value",
        (d) =>
          (d.paths["/api/v1/home"].get.parameters[0].schema.enum = ["title"]),
        "request-enum-lost-value",
      ],
      [
        "a request parameter changing type",
        (d) =>
          (d.paths["/api/v1/read/{workId}"].parameters[0].schema = {
            type: "integer",
          }),
        "request-type-changed",
      ],
      [
        "a new required request body property (through a $ref)",
        (d) => {
          highlight(d).properties.excerpt = { type: "string" };
          highlight(d).required.push("excerpt");
        },
        "new-required-request-property",
      ],
      [
        "an optional request body property becoming required",
        (d) => highlight(d).required.push("color"),
        "request-property-became-required",
      ],
      [
        "a request body enum losing a value",
        (d) => (highlight(d).properties.color.enum = ["yellow"]),
        "request-enum-lost-value",
      ],
      [
        "a removed request oneOf variant",
        (d) =>
          d.paths["/api/v1/read/{workId}"].post.requestBody.content[
            "application/x-www-form-urlencoded"
          ].schema.oneOf.pop(),
        "request-removed-variant",
      ],
      [
        "a removed request media type",
        (d) => {
          const c = d.paths["/api/v1/read/{workId}"].post.requestBody.content;
          c["application/json"] = c["application/x-www-form-urlencoded"];
          delete c["application/x-www-form-urlencoded"];
        },
        "removed-request-media-type",
      ],
      [
        "a new required request body on an operation that had none",
        (d) =>
          (d.paths["/api/v1/home"].get.requestBody = {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          }),
        "new-required-request-body",
      ],
      [
        "a dropped security scheme",
        (d) => (d.security = [{ cookieAuth: [] }]),
        "security-changed",
      ],
      [
        "a changed security scheme definition",
        (d) => (d.components.securitySchemes.cookieAuth.name = "__other"),
        "security-changed",
      ],
      [
        "an operation-level override narrowing security",
        (d) => (d.paths["/api/v1/home"].get.security = [{ bearerAuth: [] }]),
        "security-changed",
      ],
      [
        "a closed response object dropping additionalProperties:false",
        (d) => delete workItem(d).additionalProperties,
        "response-opened-closed-object",
      ],
      [
        "a closed response object allowing a schema of extra keys",
        (d) => (workItem(d).additionalProperties = { type: "string" }),
        "response-opened-closed-object",
      ],
      [
        "a response date-time losing its format",
        (d) => delete workItem(d).properties.createdAt.format,
        "response-format-changed",
      ],
      [
        "a response number widening from integer",
        (d) => (workItem(d).properties.count.type = "number"),
        "response-type-changed",
      ],
      [
        "a request integer narrowing from number",
        (d) => (highlight(d).properties.offset.type = "integer"),
        "request-type-changed",
      ],
      [
        "a request gaining a format",
        (d) => (highlight(d).properties.spans.format = "uuid"),
        "request-format-changed",
      ],
      [
        "a request minLength being added",
        (d) => (highlight(d).properties.spans.minLength = 5),
        "request-constraint-tightened",
      ],
      [
        "a request maxLength being lowered",
        (d) => (highlight(d).properties.spans.maxLength = 10),
        "request-constraint-tightened",
      ],
      [
        "a request pattern being added",
        (d) => (highlight(d).properties.spans.pattern = "^[0-9]+$"),
        "request-constraint-tightened",
      ],
      [
        "a request property no longer accepting null",
        (d) => delete highlight(d).properties.note.nullable,
        "request-no-longer-nullable",
      ],
      [
        "a response oneOf collapsing to an unrelated schema",
        (d) => (home200(d).properties.suggestion = { type: "string" }),
        "response-added-variant",
      ],
      [
        "a response object widening into a oneOf",
        (d) =>
          (workItem(d).properties.author = {
            oneOf: [{ type: "string", nullable: true }, { type: "integer" }],
          }),
        "response-added-variant",
      ],
      [
        "a request oneOf collapsing to one variant",
        (d) =>
          (d.paths["/api/v1/read/{workId}"].post.requestBody.content[
            "application/x-www-form-urlencoded"
          ].schema = { $ref: "#/components/schemas/BookmarkAction" }),
        "request-removed-variant",
      ],
    ];

    it.each(cases)("flags %s", (_label, mutate, kind) => {
      expect(kinds(headFrom(mutate))).toContain(kind);
    });

    it("flags a request body going from optional to required", () => {
      const optionalBody = headFrom(
        (d) =>
          (d.paths["/api/v1/read/{workId}"].post.requestBody.required = false),
      );
      expect(
        findBreakingChanges(optionalBody, baseDoc()).map((f) => f.kind),
      ).toEqual(["request-body-became-required"]);
    });

    it("flags a response oneOf replaced by a non-union schema", () => {
      const findings = findBreakingChanges(
        baseDoc(),
        headFrom(
          (d) => (home200(d).properties.suggestion = { type: "string" }),
        ),
      );
      expect(findings.map((f) => f.path)).toEqual([
        "GET /api/v1/home 200 application/json.suggestion",
      ]);
    });

    it("reports a precise location", () => {
      const findings = findBreakingChanges(
        baseDoc(),
        headFrom((d) => delete workItem(d).properties.author),
      );
      expect(findings).toEqual([
        {
          path: "GET /api/v1/home 200 application/json.works[].author",
          kind: "removed-response-property",
          detail: "property removed",
        },
      ]);
    });
  });

  describe("additive, not flagged", () => {
    const cases: Array<[string, (doc: any) => void]> = [
      [
        "a new path",
        (d) =>
          (d.paths["/api/v1/extra"] = {
            get: { operationId: "getExtra", responses: {} },
          }),
      ],
      [
        "a new method on an existing path",
        (d) =>
          (d.paths["/api/v1/home"].post = {
            operationId: "postHome",
            responses: {},
          }),
      ],
      [
        "a new response status",
        (d) =>
          (d.paths["/api/v1/home"].get.responses["429"] = {
            description: "slow down",
          }),
      ],
      [
        "a new optional query parameter",
        (d) =>
          d.paths["/api/v1/home"].get.parameters.push({
            name: "page",
            in: "query",
            required: false,
            schema: { type: "integer" },
          }),
      ],
      [
        "a new optional request body property",
        (d) => (highlight(d).properties.excerpt = { type: "string" }),
      ],
      [
        "a new request enum value",
        (d) => highlight(d).properties.color.enum.push("blue"),
      ],
      [
        "a new request oneOf variant",
        (d) =>
          d.paths["/api/v1/read/{workId}"].post.requestBody.content[
            "application/x-www-form-urlencoded"
          ].schema.oneOf.push({
            type: "object",
            properties: { intent: { type: "string", enum: ["note"] } },
            required: ["intent"],
          }),
      ],
      [
        "a request property becoming optional",
        (d) => (highlight(d).required = ["intent"]),
      ],
      [
        "a renamed path template parameter",
        (d) => {
          d.paths["/api/v1/read/{id}"] = d.paths["/api/v1/read/{workId}"];
          delete d.paths["/api/v1/read/{workId}"];
          d.paths["/api/v1/read/{id}"].parameters[0].name = "id";
        },
      ],
      [
        "a response number narrowing to integer",
        (d) => (home200(d).properties.score.type = "integer"),
      ],
      [
        "a request integer widening to number",
        (d) =>
          (d.paths["/api/v1/home"].get.parameters[1].schema.type = "number"),
      ],
      [
        "a security scheme gaining a description",
        (d) => (d.components.securitySchemes.bearerAuth.description = "token"),
      ],
      [
        "a request constraint loosening",
        (d) => (highlight(d).properties.spans.maxLength = 10_000),
      ],
      [
        "a response oneOf narrowing to one of its variants",
        (d) =>
          (home200(d).properties.suggestion =
            home200(d).properties.suggestion.oneOf[1]),
      ],
      [
        "a request object widening into a oneOf that keeps it",
        (d) =>
          (d.paths["/api/v1/home"].get.parameters[1].schema = {
            oneOf: [{ type: "integer" }, { type: "string" }],
          }),
      ],
      [
        "a response format being added",
        (d) => (workItem(d).properties.id.format = "uuid"),
      ],
      [
        "a new alternative security requirement",
        (d) => d.security.push({ apiKey: [] }),
      ],
      [
        "an operation becoming unauthenticated",
        (d) => (d.paths["/api/v1/home"].get.security = []),
      ],
      [
        "an edited description",
        (d) =>
          (d.paths["/api/v1/home"].get.responses["200"].description = "shelf"),
      ],
    ];

    it.each(cases)("allows %s", (_label, mutate) => {
      expect(findBreakingChanges(baseDoc(), headFrom(mutate))).toEqual([]);
    });

    // These two need a different base than baseDoc(): the closed-object rule
    // keys off what the *base* declared, since that's what installed
    // clients were generated from.
    it("allows a new property on a response object the base left open", () => {
      const base = headFrom((d) => delete home200(d).additionalProperties);
      const head = structuredClone(base) as any;
      home200(head).properties.extra = { type: "string" };
      expect(findBreakingChanges(base, head)).toEqual([]);
    });

    it("allows an optional response property becoming required", () => {
      const base = headFrom(
        (d) => (home200(d).properties.note = { type: "string" }),
      );
      const head = structuredClone(base) as any;
      home200(head).required.push("note");
      expect(findBreakingChanges(base, head)).toEqual([]);
    });
  });
});

describe("resolveLocalRefs", () => {
  it("inlines #/components refs", () => {
    const doc = resolveLocalRefs({
      components: { schemas: { A: { type: "string" } } },
      x: { $ref: "#/components/schemas/A" },
    });
    expect(doc.x).toEqual({ type: "string" });
  });

  it("leaves a self-referential ref in place instead of looping", () => {
    const doc = resolveLocalRefs({
      components: {
        schemas: {
          Node: {
            type: "object",
            properties: { next: { $ref: "#/components/schemas/Node" } },
          },
        },
      },
      x: { $ref: "#/components/schemas/Node" },
    }) as any;
    expect(doc.x.properties.next).toEqual({
      $ref: "#/components/schemas/Node",
    });
  });
});

describe("hasBreakingChangeTrailer", () => {
  it("accepts the trailer with a reason", () => {
    expect(
      hasBreakingChangeTrailer(
        "Drop legacy field\n\nAPI-Breaking-Change: iOS 1.2 no longer reads it\n",
      ),
    ).toBe(true);
  });

  it("rejects a trailer with no reason", () => {
    expect(hasBreakingChangeTrailer("x\n\nAPI-Breaking-Change:\n")).toBe(false);
  });

  it("rejects the phrase mid-line", () => {
    expect(
      hasBreakingChangeTrailer("mentions API-Breaking-Change: in prose"),
    ).toBe(false);
  });
});
