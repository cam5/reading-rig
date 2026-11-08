import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "./openapi.server";

// The iOS client's Swift types are generated from the committed
// openapi/api-v1.json, not from the live /api/v1/openapi route — so that
// file drifting from what the routes' zod schemas actually produce means
// the app gets built against a contract the server no longer honors.
// Deep-equal rather than a byte compare: the committed file goes through
// Prettier (pre-commit hook), which reflows short arrays onto one line.
const SPEC_PATH = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "openapi",
  "api-v1.json",
);

describe("openapi/api-v1.json", () => {
  it("matches what buildOpenApiDocument() generates", () => {
    const committed = JSON.parse(readFileSync(SPEC_PATH, "utf8"));
    expect(
      committed,
      "openapi/api-v1.json is stale — run npm run generate:openapi and commit the result",
    ).toEqual(buildOpenApiDocument());
  });
});
