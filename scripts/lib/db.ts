import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../generated/prisma/client";

/**
 * A standalone PrismaClient for one-off CLI scripts (seed, ingest) — unlike
 * app/db.server.ts, no HMR-reload caching: each script run is its own
 * process with nothing to cache across.
 */
export function createStandaloneDb(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
  return new PrismaClient({ adapter });
}
