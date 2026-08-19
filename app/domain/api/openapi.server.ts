import { z } from "zod";
import { homeResponseSchema } from "./schemas/home.server";
import {
  commonplaceResponseSchema,
  commonplaceEntryResponseSchema,
} from "./schemas/commonplace.server";
import {
  readResponseSchema,
  readActionResponseSchema,
  highlightActionSchema,
  highlightNoteActionSchema,
  noteActionSchema,
  bookmarkActionSchema,
} from "./schemas/read.server";
import { readContentResponseSchema } from "./schemas/readContent.server";
import { mentionSuggestionsResponseSchema } from "./schemas/mentionSuggestions.server";
import {
  rigSessionsResponseSchema,
  rigSessionCreateResponseSchema,
} from "./schemas/rigSessions.server";
import {
  rigMessageRequestSchema,
  rigMessageResponseSchema,
} from "./schemas/rig.server";

/**
 * Generates the OpenAPI 3.0 document for the /api/v1 surface, straight from
 * the same zod schemas every route already validates against — see
 * errors.server.ts and each route file. One function, two callers:
 * api.v1.openapi.tsx serves it live, and scripts/generateOpenApi.ts writes
 * the same output to openapi/api-v1.json so a route's contract changing
 * shows up as a diff in review, not just a runtime surprise.
 *
 * Deliberately not using a components/$ref-sharing registry (zod v4 has
 * one — z.toJSONSchema(registry, ...) — see its source for the shape):
 * every schema below is inlined at its call site. That means e.g. the
 * paragraph shape is duplicated between GET /read and GET /read-content's
 * responses instead of both pointing at one named component — a real
 * cost for a Swift codegen tool (duplicate anonymous structs instead of
 * one shared type), but the registry's $ref/$defs plumbing is real
 * complexity too, and this is v1's minimum viable contract, not the
 * final shape.
 *
 * One exception, now that a client exists to feel the pain:
 * READ_ACTION_SCHEMAS below registers postReadAction's four request
 * variants as named components.schemas and $refs them from a oneOf,
 * because swift-openapi-generator can only turn a oneOf into a tagged
 * Swift enum when its members are $refs — an inline oneOf (what every
 * other schema in this file still produces) gets silently skipped
 * instead. Response-side duplication is untouched; nothing has
 * needed a typed response union badly enough yet to justify doing the
 * same there.
 *
 * A second, honest simplification: this models each route's *declared*
 * contract (its zod schemas), not literally every code path. A few
 * business-rule failures inside handleReadAction.server.ts (an empty
 * note body, an unknown intent, a highlight span that doesn't resolve to
 * a real paragraph) throw a bare `Response("...", {status})` with a
 * text/plain body, not the JSON {error, issues} envelope parseOrBadRequest
 * produces — same asymmetry assertWorkReadableBy's 404s already have.
 * Documented here in prose rather than modeled as a oneOf on every
 * affected response, which would bloat the doc for edge cases a client
 * mostly just needs to tolerate a non-JSON error body for.
 */

type JsonSchema = Record<string, unknown>;

function schemaFor(
  zodSchema: z.ZodType,
  io: "input" | "output" = "output",
): JsonSchema {
  return z.toJSONSchema(zodSchema, {
    target: "openapi-3.0",
    // z.date() throws by default ("Date cannot be represented in JSON
    // Schema") — every date in this API is a real Date on the server and
    // an ISO string on the wire (JSON.stringify's own behavior), so map
    // it explicitly via override rather than losing the type to `{}`.
    unrepresentable: "any",
    io,
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema instanceof z.ZodDate) {
        jsonSchema.type = "string";
        jsonSchema.format = "date-time";
      }
    },
  }) as JsonSchema;
}

function jsonResponse(description: string, zodSchema: z.ZodType) {
  return {
    description,
    content: { "application/json": { schema: schemaFor(zodSchema) } },
  };
}

// Requests validate the *input* type (pre-transform — e.g. rigMessageRequestSchema's
// shape before any transform runs), since that's what actually crosses the
// wire; responses validate the *output* type (the default), since that's
// what the route's own `.parse()` call checks. readActionRequestSchema
// used to go through here too — it's the one $ref'd oneOf now
// (readActionRequestBody above), since this form doesn't produce $refs.
function formRequestBody(zodSchema: z.ZodType) {
  const body = schemaFor(zodSchema, "input");
  return {
    required: true,
    content: {
      "application/x-www-form-urlencoded": { schema: body },
      "multipart/form-data": { schema: body },
    },
  };
}

// The one oneOf in this API that a client actually needs a real tagged
// enum for — a Swift client posting a read action has to construct one of
// four different request shapes, not just read a response. schemaFor's
// usual inlining (this file's own doc comment on why that's the default)
// makes that impossible for swift-openapi-generator specifically: it can
// only turn a oneOf into an enum when its members are $refs to named
// components/schemas, not inline object schemas — confirmed by trying it
// with the inlined version, which the generator silently skipped with
// "Schema oneOf () is not supported, reason: not a reference". Named here,
// registered into components.schemas by buildOpenApiDocument below, and
// referenced by name everywhere else — the only schema in this file that
// gets that treatment, on purpose.
const READ_ACTION_SCHEMAS: Record<string, z.ZodType> = {
  ReadHighlightAction: highlightActionSchema,
  ReadHighlightNoteAction: highlightNoteActionSchema,
  ReadNoteAction: noteActionSchema,
  ReadBookmarkAction: bookmarkActionSchema,
};

const READ_ACTION_INTENT_TO_SCHEMA: Record<string, string> = {
  highlight: "ReadHighlightAction",
  "highlight-note": "ReadHighlightNoteAction",
  note: "ReadNoteAction",
  bookmark: "ReadBookmarkAction",
};

function readActionRequestBody() {
  const oneOf = Object.keys(READ_ACTION_SCHEMAS).map((name) => ({
    $ref: `#/components/schemas/${name}`,
  }));
  const schema: JsonSchema = {
    oneOf,
    discriminator: {
      propertyName: "intent",
      mapping: Object.fromEntries(
        Object.entries(READ_ACTION_INTENT_TO_SCHEMA).map(([intent, name]) => [
          intent,
          `#/components/schemas/${name}`,
        ]),
      ),
    },
  };
  return {
    required: true,
    content: {
      "application/x-www-form-urlencoded": { schema },
      "multipart/form-data": { schema },
    },
  };
}

function queryParam(
  name: string,
  opts: { required?: boolean; type?: "string" | "number"; description: string },
) {
  return {
    name,
    in: "query" as const,
    required: opts.required ?? false,
    schema: { type: opts.type ?? "string" },
    description: opts.description,
  };
}

function pathParam(name: string, description: string) {
  return {
    name,
    in: "path" as const,
    required: true,
    schema: { type: "string" },
    description,
  };
}

// A splat, not a single dynamic segment — a Work id is a slash-shaped slug
// (see routes.ts's own comment on `read/*`). OpenAPI 3.0 path templates
// can't natively express "everything after this prefix" as one named
// parameter; `{workId}` here is a documented approximation a codegen tool
// will treat as a single non-slash segment unless told otherwise.
const workIdParam = pathParam(
  "workId",
  'A Work\'s slash-shaped id (e.g. "karl-marx/capital-volume-i"). Despite the ' +
    "single {workId} placeholder shown here, this is a path splat on the " +
    "server — the real id may itself contain slashes.",
);

const sessionQueryParam = queryParam("session", {
  description:
    "A specific RigSession id. Omitted, falls back to the most recently " +
    "created session for this (user, work), creating one on first use.",
});

const unauthorizedResponse = jsonResponse(
  "No session cookie, and no dev-fallback user configured.",
  z.object({ error: z.literal("Unauthorized") }),
);

const badRequestResponse = jsonResponse(
  "Request failed schema validation.",
  z.object({
    error: z.literal("Bad request"),
    issues: z.array(z.object({ path: z.string(), message: z.string() })),
  }),
);

const notFoundResponse = {
  description:
    "Not found, or not owned by the authenticated user — same response " +
    "either way, so a client can't distinguish a bad id from someone else's " +
    "work by probing.",
  content: {
    "text/plain": { schema: { type: "string" }, example: "Not found" },
  },
};

export function buildOpenApiDocument(): JsonSchema {
  return {
    openapi: "3.0.3",
    info: {
      title: "Reading Rig API",
      version: "1",
      description:
        "The JSON surface behind reading-rig's own React Router pages (see " +
        "issue #192) — read data plus highlight/note/bookmark writes for a " +
        "future non-browser client. Every route validates its own request " +
        "and response against the schemas this document is generated from " +
        "(app/domain/api/schemas/); see openapi.server.ts's own doc comment " +
        "for the two places that document diverges from the code's edge " +
        "cases on purpose. Accepts either credential in `security` below — " +
        "a browser session cookie or an Authorization: Bearer token minted " +
        "via `npm run api-token create` (see apiToken.server.ts).",
    },
    servers: [{ url: "/" }],
    // Either credential works — requireApiUserId checks Bearer first, then
    // falls back to the cookie (session.server.ts) — so this lists both as
    // alternatives, not a combination a client has to satisfy at once.
    security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    components: {
      securitySchemes: {
        // What the browser itself already sends: the __rig_session cookie
        // magic-link login sets (session.server.ts).
        cookieAuth: { type: "apiKey", in: "cookie", name: "__rig_session" },
        // A long-lived credential for a non-browser client — minted via
        // `npm run api-token create <email> [label]`, never through a
        // sign-in flow of its own. See ApiToken's schema.prisma comment
        // and apiToken.server.ts for how it's issued, hashed, and checked.
        bearerAuth: { type: "http", scheme: "bearer" },
      },
      // Only the read-action variants live here — see READ_ACTION_SCHEMAS'
      // own comment for why this is the one exception to inlining
      // everything else in this document.
      schemas: Object.fromEntries(
        Object.entries(READ_ACTION_SCHEMAS).map(([name, zodSchema]) => [
          name,
          schemaFor(zodSchema, "input"),
        ]),
      ),
    },
    paths: {
      "/api/v1/home": {
        get: {
          operationId: "getHome",
          summary: "List the signed-in user's shelf.",
          responses: {
            "200": jsonResponse("The user's shelf.", homeResponseSchema),
            "401": unauthorizedResponse,
          },
        },
      },
      "/api/v1/read/{workId}": {
        parameters: [workIdParam],
        get: {
          operationId: "getRead",
          summary:
            "A work's full read-page data: outline, initial content window, and reading position.",
          parameters: [
            queryParam("section", {
              description:
                "A chapter::section id to open at instead of the reader's saved position.",
            }),
          ],
          responses: {
            "200": jsonResponse(
              "The work's read-page data.",
              readResponseSchema,
            ),
            "401": unauthorizedResponse,
            "404": notFoundResponse,
          },
        },
        post: {
          operationId: "postReadAction",
          summary:
            "Highlight, annotate, or bookmark — the four intents handleReadAction.server.ts dispatches on.",
          requestBody: readActionRequestBody(),
          responses: {
            "200": jsonResponse(
              "The write succeeded.",
              readActionResponseSchema,
            ),
            "400": badRequestResponse,
            "401": unauthorizedResponse,
            "404": notFoundResponse,
          },
        },
      },
      "/api/v1/read-content": {
        get: {
          operationId: "getReadContent",
          summary:
            "A specific paragraph window, by global ordinal range — the reader's scroll-driven prefetch.",
          parameters: [
            queryParam("work", { required: true, description: "The Work id." }),
            queryParam("min", {
              required: true,
              type: "number",
              description: "Minimum global ordinal, inclusive.",
            }),
            queryParam("max", {
              required: true,
              type: "number",
              description: "Maximum global ordinal, inclusive.",
            }),
          ],
          responses: {
            "200": jsonResponse(
              "The requested paragraph window.",
              readContentResponseSchema,
            ),
            "400": badRequestResponse,
            "401": unauthorizedResponse,
            "404": notFoundResponse,
          },
        },
      },
      "/api/v1/mention-suggestions": {
        get: {
          operationId: "getMentionSuggestions",
          summary: 'Autocomplete candidates for the composer\'s "@" mentions.',
          parameters: [
            queryParam("work", { required: true, description: "The Work id." }),
            queryParam("q", {
              required: true,
              description:
                'The text typed after "@" — may be empty, meaning "closest to my bookmark."',
            }),
          ],
          responses: {
            "200": jsonResponse(
              "Candidate paragraphs and notes.",
              mentionSuggestionsResponseSchema,
            ),
            "400": badRequestResponse,
            "401": unauthorizedResponse,
            "404": notFoundResponse,
          },
        },
      },
      "/api/v1/commonplace": {
        get: {
          operationId: "getCommonplace",
          summary:
            "The user's commonplace-book shelf: every entry, grouped and counted.",
          parameters: [
            queryParam("entry", {
              description: "An entry id to select and expand in the margin.",
            }),
          ],
          responses: {
            "200": jsonResponse(
              "The commonplace shelf.",
              commonplaceResponseSchema,
            ),
            "401": unauthorizedResponse,
          },
        },
      },
      "/api/v1/commonplace/{entryId}": {
        parameters: [pathParam("entryId", "An Entry id.")],
        get: {
          operationId: "getCommonplaceEntry",
          summary: "One commonplace-book entry.",
          responses: {
            "200": jsonResponse("The entry.", commonplaceEntryResponseSchema),
            "401": unauthorizedResponse,
            "404": notFoundResponse,
          },
        },
      },
      "/api/v1/rig/{workId}": {
        parameters: [workIdParam, sessionQueryParam],
        get: {
          operationId: "streamRigSession",
          summary: "Open the Rig's session stream (Server-Sent Events).",
          description:
            "Not modeled with a JSON response schema — this always returns " +
            "text/event-stream, and every event on the stream is one of " +
            "RigSessionEvent's variants (app/rig/sessionSource.ts), not a " +
            "single request/response body. Excluded from apiV1.smoke.test.ts " +
            "for the same reason: opening a real Anthropic session needs " +
            "network access and ANTHROPIC_API_KEY neither CI nor this doc " +
            "generator has.",
          responses: {
            "200": {
              description: "An SSE stream of RigSessionEvent frames.",
              content: { "text/event-stream": {} },
            },
            "401": unauthorizedResponse,
            "404": notFoundResponse,
          },
        },
        post: {
          operationId: "postRigMessage",
          summary: "Send a plain-text message into the Rig session.",
          requestBody: formRequestBody(rigMessageRequestSchema),
          responses: {
            "200": jsonResponse(
              "The message was sent.",
              rigMessageResponseSchema,
            ),
            "400": badRequestResponse,
            "401": unauthorizedResponse,
            "404": notFoundResponse,
          },
        },
      },
      "/api/v1/rig-sessions/{workId}": {
        parameters: [workIdParam],
        get: {
          operationId: "listRigSessions",
          summary:
            "List past Rig sessions for a work — the session picker's data source.",
          responses: {
            "200": jsonResponse(
              "The work's Rig sessions.",
              rigSessionsResponseSchema,
            ),
            "401": unauthorizedResponse,
            "404": notFoundResponse,
          },
        },
        post: {
          operationId: "createRigSession",
          summary: "Start a new Rig session for a work.",
          responses: {
            "200": jsonResponse(
              "The new session.",
              rigSessionCreateResponseSchema,
            ),
            "401": unauthorizedResponse,
            "404": notFoundResponse,
          },
        },
      },
    },
  };
}
