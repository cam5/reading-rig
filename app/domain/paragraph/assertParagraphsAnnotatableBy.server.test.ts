import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../../generated/prisma/client";
import { assertParagraphsAnnotatableBy } from "./assertParagraphsAnnotatableBy.server";

// A real sqlite file, schema-pushed fresh per test file — see
// persistWork.server.test.ts for why this isn't a hand-rolled CREATE TABLE.
let dbPath: string;
let db: PrismaClient;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rr-assertannotatable-"));
  dbPath = join(dir, "test.db");
  execFileSync("npx", ["prisma", "db", "push", "--url", `file:${dbPath}`], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  db = new PrismaClient({ adapter });

  await db.user.create({ data: { id: "u1" } });
  await db.user.create({ data: { id: "u2" } });

  for (const [ownerId, workId] of [
    ["u1", "work-1"],
    ["u2", "work-2"],
  ] as const) {
    await db.work.create({
      data: {
        id: workId,
        title: workId,
        author: "Author",
        ownerId,
        chapters: {
          create: {
            id: `${workId}::c1`,
            label: "Chapter 1",
            ordinal: 1,
            sections: {
              create: {
                id: `${workId}::c1::s1`,
                label: "1",
                ordinal: 1,
                paragraphs: {
                  create: {
                    id: `${workId}::p1`,
                    ordinal: 1,
                    globalOrdinal: 1,
                    html: "One.",
                    text: "One.",
                    wordCount: 1,
                  },
                },
              },
            },
          },
        },
      },
    });
  }
});

afterAll(async () => {
  await db.$disconnect();
  if (dbPath && existsSync(dbPath)) rmSync(dbPath, { force: true });
});

describe("assertParagraphsAnnotatableBy", () => {
  it("resolves without throwing when every paragraph's work is owned by the user", async () => {
    await expect(
      assertParagraphsAnnotatableBy(db, "u1", ["work-1::p1"]),
    ).resolves.toBeUndefined();
  });

  it("throws 404 for a paragraph whose work belongs to a different user", async () => {
    await expect(
      assertParagraphsAnnotatableBy(db, "u1", ["work-2::p1"]),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("throws 404 for a paragraph id that doesn't exist at all", async () => {
    await expect(
      assertParagraphsAnnotatableBy(db, "u1", ["does-not-exist"]),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("throws 404 if any one paragraph in a multi-paragraph selection isn't annotatable", async () => {
    // A spanning highlight touching one annotatable and one non-annotatable
    // paragraph must be rejected wholesale, not partially accepted.
    await expect(
      assertParagraphsAnnotatableBy(db, "u1", ["work-1::p1", "work-2::p1"]),
    ).rejects.toMatchObject({ status: 404 });
  });
});
