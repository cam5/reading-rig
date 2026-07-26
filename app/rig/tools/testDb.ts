import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../../generated/prisma/client";
import { TEST_DB_TEMPLATE_PATH } from "./globalSetupDb";

/**
 * A fresh, real SQLite database for one test file — a copy of the template
 * globalSetupDb.ts pushed the schema into once, not a re-run of `prisma db
 * push` per file. Copying a small file is effectively instant and gives
 * each test file total isolation: no shared rows, no lock contention
 * between parallel Vitest workers touching the same file.
 *
 * Callers own the returned client's lifecycle — call `$disconnect()` in an
 * `afterEach`/`afterAll`, the same as any other PrismaClient.
 */
export function createTestDb(): PrismaClient {
  const dir = mkdtempSync(join(tmpdir(), "reading-rig-test-"));
  const dbPath = join(dir, "test.db");
  copyFileSync(TEST_DB_TEMPLATE_PATH, dbPath);

  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  return new PrismaClient({ adapter });
}
