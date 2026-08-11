import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../../generated/prisma/client";
import { fetchContentWindow } from "./fetchContentWindow.server";

// A real sqlite file, schema-pushed fresh per test file — see
// persistWork.server.test.ts for why this isn't a hand-rolled CREATE TABLE.
let dbPath: string;
let db: PrismaClient;

function paragraphData(id: string, ordinal: number, globalOrdinal: number, text: string) {
  return { id, ordinal, globalOrdinal, html: text, text, wordCount: text.split(/\s+/).length };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rr-fetchcontentwindow-"));
  dbPath = join(dir, "test.db");
  execFileSync("npx", ["prisma", "db", "push", "--url", `file:${dbPath}`], { cwd: process.cwd(), stdio: "pipe" });
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  db = new PrismaClient({ adapter });

  await db.user.create({ data: { id: "u1", email: "u1@test.example" } });

  // work-1: 6 paragraphs (globalOrdinal 1..6). A highlight spans
  // paragraphs 3 and 5 — the fetch below requests only [4,6], so
  // paragraph 3 is the "reaches outside the requested range" case.
  await db.work.create({
    data: {
      id: "work-1",
      title: "work-1",
      author: "Author",
      ownerId: "u1",
      chapters: {
        create: {
          id: "work-1::c1",
          label: "Chapter 1",
          ordinal: 1,
          sections: {
            create: {
              id: "work-1::c1::s1",
              label: "1",
              ordinal: 1,
              paragraphs: {
                create: [
                  paragraphData("work-1::p1", 1, 1, "One."),
                  paragraphData("work-1::p2", 2, 2, "Two."),
                  paragraphData("work-1::p3", 3, 3, "Three, the one a highlight reaches from outside the window."),
                  paragraphData("work-1::p4", 4, 4, "Four."),
                  paragraphData("work-1::p5", 5, 5, "Five, the other end of the same highlight."),
                  paragraphData("work-1::p6", 6, 6, "Six."),
                ],
              },
            },
          },
        },
      },
    },
  });

  // work-2: a *different* work whose own paragraph 5 must never leak into
  // a work-1 query for the same ordinal range — globalOrdinal is only
  // unique per work.
  await db.work.create({
    data: {
      id: "work-2",
      title: "work-2",
      author: "Author",
      ownerId: "u1",
      chapters: {
        create: {
          id: "work-2::c1",
          label: "Chapter 1",
          ordinal: 1,
          sections: {
            create: {
              id: "work-2::c1::s1",
              label: "1",
              ordinal: 1,
              paragraphs: { create: [paragraphData("work-2::p5", 5, 5, "A different book's paragraph five.")] },
            },
          },
        },
      },
    },
  });

  await db.highlight.create({
    data: {
      id: "h1",
      userId: "u1",
      role: "hand",
      spans: {
        create: [
          { paragraphId: "work-1::p3", startOffset: 0, endOffset: 5 },
          { paragraphId: "work-1::p5", startOffset: 0, endOffset: 4 },
        ],
      },
    },
  });

  await db.entry.create({
    data: {
      id: "e1",
      userId: "u1",
      origin: "hand",
      body: "A note on paragraph 4.",
      anchorParagraphId: "work-1::p4",
      contextSnapshot: {},
    },
  });
  await db.entry.create({
    data: {
      id: "e2",
      userId: "u1",
      origin: "hand",
      body: "A note on paragraph 3, outside the requested range.",
      anchorParagraphId: "work-1::p3",
      contextSnapshot: {},
    },
  });
});

afterAll(async () => {
  await db.$disconnect();
  if (dbPath && existsSync(dbPath)) rmSync(dbPath, { force: true });
});

describe("fetchContentWindow", () => {
  it("returns paragraphs in the requested range plus any paragraph a straddling highlight also reaches", async () => {
    const result = await fetchContentWindow(db, "work-1", { minGlobalOrdinal: 4, maxGlobalOrdinal: 6 });
    expect(result.map((p) => p.id)).toEqual(["work-1::p3", "work-1::p4", "work-1::p5", "work-1::p6"]);
  });

  it("attaches the full highlight (both spans) to every paragraph it reaches, including the one outside the range", async () => {
    const result = await fetchContentWindow(db, "work-1", { minGlobalOrdinal: 4, maxGlobalOrdinal: 6 });
    const p3 = result.find((p) => p.id === "work-1::p3")!;
    const p5 = result.find((p) => p.id === "work-1::p5")!;
    const p4 = result.find((p) => p.id === "work-1::p4")!;
    expect(p3.highlightSpans).toHaveLength(1);
    expect(p3.highlightSpans[0].highlight.id).toBe("h1");
    expect(p5.highlightSpans).toHaveLength(1);
    expect(p4.highlightSpans).toEqual([]);
  });

  it("attaches entries for both in-range and over-fetched paragraphs", async () => {
    const result = await fetchContentWindow(db, "work-1", { minGlobalOrdinal: 4, maxGlobalOrdinal: 6 });
    const p3 = result.find((p) => p.id === "work-1::p3")!;
    const p4 = result.find((p) => p.id === "work-1::p4")!;
    expect(p4.entries.map((e) => e.id)).toEqual(["e1"]);
    expect(p3.entries.map((e) => e.id)).toEqual(["e2"]);
  });

  it("never crosses into another work's paragraphs sharing the same globalOrdinal", async () => {
    // work-2 also has a paragraph at globalOrdinal 5 — p2 here has no
    // highlight, so unlike p5 above it can isolate the workId scoping
    // itself from the highlight-reach behavior.
    const result = await fetchContentWindow(db, "work-1", { minGlobalOrdinal: 2, maxGlobalOrdinal: 2 });
    expect(result.map((p) => p.id)).toEqual(["work-1::p2"]);
  });

  it("returns an empty list for a range with no paragraphs and no highlights to chase", async () => {
    const result = await fetchContentWindow(db, "work-1", { minGlobalOrdinal: 100, maxGlobalOrdinal: 200 });
    expect(result).toEqual([]);
  });
});
