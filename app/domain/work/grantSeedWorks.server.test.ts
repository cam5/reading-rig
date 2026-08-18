import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../../generated/prisma/client";
import { grantSeedWorks } from "./grantSeedWorks.server";

// A real sqlite file, schema-pushed fresh per test file — see
// persistWork.server.test.ts for why this isn't a hand-rolled CREATE TABLE.
let dbPath: string;
let db: PrismaClient;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rr-grantseedworks-"));
  dbPath = join(dir, "test.db");
  execFileSync("npx", ["prisma", "db", "push", "--url", `file:${dbPath}`], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  db = new PrismaClient({ adapter });

  await db.user.create({
    data: { id: "library", email: "library@test.example" },
  });
  await db.user.create({
    data: { id: "reader", email: "reader@test.example" },
  });
  await db.work.create({
    data: {
      id: "seed-work",
      title: "Seed Work",
      ownerId: "library",
      isSeedWork: true,
    },
  });
  await db.work.create({
    data: {
      id: "regular-work",
      title: "Regular Work",
      ownerId: "library",
      isSeedWork: false,
    },
  });
});

afterAll(async () => {
  await db.$disconnect();
  if (dbPath && existsSync(dbPath)) rmSync(dbPath, { force: true });
});

describe("grantSeedWorks", () => {
  it("grants only isSeedWork works, not every work the library account owns", async () => {
    await grantSeedWorks(db, "reader");
    const grants = await db.workGrant.findMany({ where: { userId: "reader" } });
    expect(grants.map((g) => g.workId)).toEqual(["seed-work"]);
  });

  it("is a no-op the second time — no duplicate grant, no throw", async () => {
    await expect(grantSeedWorks(db, "reader")).resolves.toBeUndefined();
    const grants = await db.workGrant.findMany({ where: { userId: "reader" } });
    expect(grants).toHaveLength(1);
  });
});
