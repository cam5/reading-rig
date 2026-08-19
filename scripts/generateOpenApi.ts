import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { buildOpenApiDocument } from "../app/domain/api/openapi.server";

// The same document api.v1.openapi.tsx serves live, written to a committed
// file so a route's contract changing shows up as a diff in review —
// see openapi.server.ts's own doc comment for what this document does
// and doesn't model.

const OUT_DIR = path.join(import.meta.dirname, "..", "openapi");
const OUT_FILE = path.join(OUT_DIR, "api-v1.json");

await mkdir(OUT_DIR, { recursive: true });
await writeFile(
  OUT_FILE,
  `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`,
);
console.log(`Wrote ${path.relative(process.cwd(), OUT_FILE)}`);
