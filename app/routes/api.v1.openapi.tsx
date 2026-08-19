import { buildOpenApiDocument } from "~/domain/api/openapi.server";

/**
 * Serves the OpenAPI document generated from this API's own zod schemas
 * (see openapi.server.ts) — always in sync with whatever's actually
 * deployed, unlike the committed openapi/api-v1.json (regenerated via
 * `npm run generate:openapi`, kept around so a route's contract changing
 * shows up as a diff in review). Deliberately unauthenticated: this
 * describes shapes and paths, not data, and a client needs to be able to
 * fetch it before it has a session.
 */
export function loader() {
  return buildOpenApiDocument();
}
