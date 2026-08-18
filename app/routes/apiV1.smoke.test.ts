import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestHandler, type RequestHandler } from "react-router";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../generated/prisma/client";
import { TEST_DB_TEMPLATE_PATH } from "../rig/tools/globalSetupDb";

/**
 * Proves the /api/v1 surface is actually wired — right file, right verb,
 * auth attached, JSON out — by dispatching real Requests through the
 * real built route tree via React Router's own createRequestHandler, the
 * same primitive @react-router/express wraps into an HTTP server for
 * `npm start`. No port, no server process: the handler is a plain
 * `(Request) => Promise<Response>` function once the build is loaded.
 *
 * Deliberately not a contract/shape test (that's #194's OpenAPI+zod
 * follow-up) — this only checks status codes and a couple of top-level
 * keys, the class of thing a route-registration typo or a dropped export
 * breaks (see c05fea7, "restore read.tsx's loader, dropped by a bad
 * merge" — exactly the failure mode with no other test would've caught).
 *
 * `/api/v1/rig/*` (SSE) is deliberately excluded: it opens a real
 * Anthropic session, which needs ANTHROPIC_API_KEY and network access
 * neither this suite nor CI has, and a streaming response doesn't fit
 * this suite's "one request, one JSON body" shape anyway — same
 * exclusion the OpenAPI spec itself will need (see the #194 PR
 * discussion).
 */

// A dedicated copy per run, not per test case — cheap (small file), and
// every test case below shares one seeded (user, work, entry) rather than
// re-seeding for each `it`, since this suite is checking wiring, not
// testing isolation between cases the way the domain-layer suite does.
function createSmokeDb(): { db: PrismaClient; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "reading-rig-smoke-"));
  const path = join(dir, "smoke.db");
  copyFileSync(TEST_DB_TEMPLATE_PATH, path);
  const adapter = new PrismaBetterSqlite3({ url: `file:${path}` });
  return { db: new PrismaClient({ adapter }), path };
}

let db: PrismaClient;
let handler: RequestHandler;
let userId: string;
let workId: string;
let paragraphId: string;
let entryId: string;

beforeAll(async () => {
  const smoke = createSmokeDb();
  db = smoke.db;

  // Set before the server build is ever imported (the lazy `() =>
  // import(...)` below defers that until the first `handler()` call,
  // which only happens inside a test, after this hook has run) — db.server.ts
  // reads DATABASE_URL once, at module-evaluation time, so this has to
  // land before that module is first pulled into the module graph.
  process.env.DATABASE_URL = `file:${smoke.path}`;

  const user = await db.user.create({
    data: { email: "smoke@reading-rig.invalid" },
  });
  userId = user.id;

  workId = `smoke-work-${userId}`;
  await db.work.create({
    data: {
      id: workId,
      ownerId: userId,
      title: "Smoke Test Work",
      author: "Smoke Author",
    },
  });
  const chapter = await db.chapter.create({
    data: { id: `${workId}::c1`, workId, label: "Chapter 1", ordinal: 1 },
  });
  const section = await db.section.create({
    data: {
      id: `${chapter.id}::s1`,
      chapterId: chapter.id,
      label: "1",
      ordinal: 1,
    },
  });
  const paragraph = await db.paragraph.create({
    data: {
      id: `${section.id}::p1`,
      sectionId: section.id,
      html: "<p>A paragraph worth reading.</p>",
      text: "A paragraph worth reading.",
      ordinal: 1,
      globalOrdinal: 1,
      wordCount: 5,
    },
  });
  paragraphId = paragraph.id;

  const entry = await db.entry.create({
    data: {
      userId,
      origin: "hand",
      body: "A note made by hand.",
      anchorParagraphId: paragraphId,
      contextSnapshot: {},
    },
  });
  entryId = entry.id;

  const build = await import(
    pathToFileURL(resolve(import.meta.dirname, "../../build/server/index.js"))
      .href
  );
  handler = createRequestHandler(build, "production");
});

afterAll(async () => {
  await db.$disconnect();
});

function get(path: string): Promise<Response> {
  return handler(new Request(`http://localhost${path}`));
}

describe("api/v1 smoke", () => {
  it("GET /api/v1/home lists the shelf", async () => {
    const res = await get("/api/v1/home");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.works.map((w: { id: string }) => w.id)).toContain(workId);
  });

  it("GET /api/v1/read/:workId returns the work's read-page data", async () => {
    const res = await get(`/api/v1/read/${workId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.work.id).toBe(workId);
    expect(body.structuralParagraphs).toHaveLength(1);
  });

  it("GET /api/v1/read/:workId 404s for a work that doesn't exist", async () => {
    const res = await get("/api/v1/read/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("GET /api/v1/read-content returns a paragraph window", async () => {
    const res = await get(`/api/v1/read-content?work=${workId}&min=1&max=1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paragraphs).toHaveLength(1);
  });

  it("GET /api/v1/mention-suggestions returns candidates", async () => {
    const res = await get(`/api/v1/mention-suggestions?work=${workId}&q=`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.suggestions)).toBe(true);
  });

  it("GET /api/v1/commonplace lists the shelf's entries", async () => {
    const res = await get("/api/v1/commonplace");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries.map((e: { id: string }) => e.id)).toContain(entryId);
  });

  it("GET /api/v1/commonplace/:entryId returns one entry", async () => {
    const res = await get(`/api/v1/commonplace/${entryId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.id).toBe(entryId);
  });

  it("GET /api/v1/commonplace/:entryId 404s for an entry that doesn't exist", async () => {
    const res = await get("/api/v1/commonplace/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("GET /api/v1/rig-sessions/:workId lists sessions (possibly none, if the Rig isn't configured)", async () => {
    const res = await get(`/api/v1/rig-sessions/${workId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  it("POST /api/v1/read/:workId bookmark writes a real ReadingPosition", async () => {
    const formData = new FormData();
    formData.set("intent", "bookmark");
    formData.set("paragraphId", paragraphId);
    const res = await handler(
      new Request(`http://localhost/api/v1/read/${workId}`, {
        method: "POST",
        body: formData,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const position = await db.readingPosition.findUnique({
      where: { userId_workId: { userId, workId } },
    });
    expect(position?.paragraphId).toBe(paragraphId);
  });
});
