import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client";

// Prisma 7 dropped the built-in query engine binary — PrismaClient always
// takes a driver adapter now, even for a plain local SQLite file.
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });

// Vite's dev server re-evaluates this module on every HMR reload; without
// caching the instance, each reload opens a fresh connection to the SQLite
// file until something starts throwing "database is locked". Production
// gets a plain singleton — there's only one process, so there's nothing to
// cache across.
const globalForDb = globalThis as unknown as { db?: PrismaClient };

export const db: PrismaClient = globalForDb.db ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForDb.db = db;
}
