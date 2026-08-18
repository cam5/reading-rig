import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../../generated/prisma/client";
import { workAccessWhere } from "./workAccessWhere.server";

// A real sqlite file, schema-pushed fresh per test file — see
// persistWork.server.test.ts for why this isn't a hand-rolled CREATE TABLE.
let dbPath: string;
let db: PrismaClient;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rr-workaccesswhere-"));
  dbPath = join(dir, "test.db");
  execFileSync("npx", ["prisma", "db", "push", "--url", `file:${dbPath}`], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  db = new PrismaClient({ adapter });

  await db.user.create({ data: { id: "owner", email: "owner@test.example" } });
  await db.user.create({
    data: { id: "grantee", email: "grantee@test.example" },
  });
  await db.user.create({
    data: { id: "stranger", email: "stranger@test.example" },
  });
  await db.work.create({
    data: { id: "work-1", title: "work-1", ownerId: "owner" },
  });
  await db.workGrant.create({
    data: { userId: "grantee", workId: "work-1" },
  });
});

afterAll(async () => {
  await db.$disconnect();
  if (dbPath && existsSync(dbPath)) rmSync(dbPath, { force: true });
});

describe("workAccessWhere", () => {
  it("matches the owner", async () => {
    const work = await db.work.findFirst({
      where: { id: "work-1", ...workAccessWhere("owner") },
    });
    expect(work).not.toBeNull();
  });

  it("matches a user with a WorkGrant but no ownership", async () => {
    const work = await db.work.findFirst({
      where: { id: "work-1", ...workAccessWhere("grantee") },
    });
    expect(work).not.toBeNull();
  });

  it("doesn't match a user with neither ownership nor a grant", async () => {
    const work = await db.work.findFirst({
      where: { id: "work-1", ...workAccessWhere("stranger") },
    });
    expect(work).toBeNull();
  });
});
