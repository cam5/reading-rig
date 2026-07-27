import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../../generated/prisma/client";
import { persistWork } from "./persistWork.server";
import type { ParsedWork } from "./types";

// A real sqlite file, schema-pushed fresh per test file — not a hand-rolled
// CREATE TABLE — so this test can't silently drift from prisma/schema.prisma.
let dbPath: string;
let db: PrismaClient;

function minimalWork(overrides: Partial<ParsedWork> = {}): ParsedWork {
  return {
    id: "test-author/test-book@abc123",
    title: "Test Book",
    author: "Test Author",
    chapters: [
      {
        label: "Chapter 1",
        ordinal: 1,
        sections: [
          {
            label: "1",
            ordinal: 1,
            paragraphs: [
              { id: "p_one", html: "One.", text: "One.", ordinal: 1, globalOrdinal: 1 },
              { id: "p_two", html: "Two.", text: "Two.", ordinal: 2, globalOrdinal: 2 },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rr-persistwork-"));
  dbPath = join(dir, "test.db");
  execFileSync("npx", ["prisma", "db", "push", "--url", `file:${dbPath}`], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  db = new PrismaClient({ adapter });
  await db.user.create({ data: { id: "u1" } });
});

afterAll(async () => {
  await db.$disconnect();
  if (dbPath && existsSync(dbPath)) rmSync(dbPath, { force: true });
});

describe("persistWork", () => {
  it("persists the full Work -> Chapter -> Section -> Paragraph tree", async () => {
    const result = await persistWork(db, "u1", minimalWork());
    expect(result).toEqual({ workId: "test-author/test-book@abc123", chapterCount: 1, paragraphCount: 2 });

    const paragraphs = await db.paragraph.findMany({ orderBy: { ordinal: "asc" } });
    expect(paragraphs.map((p) => p.text)).toEqual(["One.", "Two."]);
  });

  it("re-persisting the same work is idempotent — no duplicate rows", async () => {
    await persistWork(db, "u1", minimalWork());
    await persistWork(db, "u1", minimalWork());

    expect(await db.work.count()).toBe(1);
    expect(await db.chapter.count()).toBe(1);
    expect(await db.section.count()).toBe(1);
    expect(await db.paragraph.count()).toBe(2);
  });

  it("rolls back the entire tree when one paragraph in it fails to persist", async () => {
    // Two paragraphs sharing the same ordinal within a section — legal
    // ParsedWork shape at the type level, but it violates
    // @@unique([sectionId, ordinal]) on the second paragraph's create,
    // partway through the transaction.
    const broken = minimalWork({
      id: "broken-author/broken-book@def456",
      chapters: [
        {
          label: "Chapter 1",
          ordinal: 1,
          sections: [
            {
              label: "1",
              ordinal: 1,
              paragraphs: [
                { id: "p_broken_one", html: "One.", text: "One.", ordinal: 1, globalOrdinal: 1 },
                // Same ordinal as above — the constraint violation that
                // must roll back everything already written for this work.
                { id: "p_broken_two", html: "Two.", text: "Two.", ordinal: 1, globalOrdinal: 2 },
              ],
            },
          ],
        },
      ],
    });

    await expect(persistWork(db, "u1", broken)).rejects.toThrow();

    // Not just the second paragraph missing — the Work row itself, created
    // first in the transaction, must be gone too. A partial ingest here
    // would be a book that silently ends mid-chapter with no error anywhere.
    expect(await db.work.findUnique({ where: { id: broken.id } })).toBeNull();
    expect(await db.paragraph.findUnique({ where: { id: "p_broken_one" } })).toBeNull();
  });
});
