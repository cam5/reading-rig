import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The one real SQLite schema every `app/rig/tools/*.test.ts` file shares.
 *
 * Unlike #24's agent config, this ticket has no API-key ceiling — the tool
 * handlers are plain Prisma queries, so the honest way to test them is a
 * real database, not a mock. But `prisma db push` is a multi-second
 * schema-engine round trip; run once per test *file* that would make a
 * six-handler suite noticeably slower for no reason. Vitest's globalSetup
 * runs this exactly once per `vitest run`, and every test file then just
 * copies the resulting file (see testDb.ts's createTestDb) — an ordinary,
 * near-instant fs operation with no schema engine involved.
 */
export const TEST_DB_TEMPLATE_PATH = join(tmpdir(), "reading-rig-vitest-template.db");

export default function setup() {
  // Wipe any template (and its WAL/journal siblings) left by a previous
  // run before pushing — `db push` reconciles schema, it doesn't guarantee
  // an empty database, and a stale row surviving from a previous run into
  // every test file's copy would be a subtle, hard-to-spot leak.
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const path = TEST_DB_TEMPLATE_PATH + suffix;
    if (existsSync(path)) rmSync(path);
  }

  execFileSync("npx", ["prisma", "db", "push", "--accept-data-loss"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB_TEMPLATE_PATH}` },
    stdio: "pipe",
  });
}
