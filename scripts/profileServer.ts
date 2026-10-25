import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client";
import { fetchCommonplaceShelf } from "../app/domain/commonplace.server";
import {
  DEFAULT_CONTENT_BYTE_BUDGET,
  selectInitialContentWindow,
} from "../app/domain/reading/contentWindow";
import { fetchContentWindow } from "../app/domain/reading/fetchContentWindow.server";
import { fetchReadPageData } from "../app/domain/reading/fetchReadPageData.server";
import { searchMentionCandidates } from "../app/domain/reading/searchMentionCandidates.server";
import { fetchShelf } from "../app/domain/work/fetchShelf.server";
import {
  assertLocalSqliteUrl,
  isWriteStatement,
  N_PLUS_ONE_QUERY_THRESHOLD,
  parseProfileArgs,
  summarize,
  type Sample,
  type Summary,
} from "./lib/perfStats";

// Server-side counterpart to lighthouserc.cjs: Lighthouse sees bytes and
// paint timings from the browser's side; this times the shared domain
// fetches every loader (page and api.v1 JSON alike) is built on, against
// the heaviest seeded work, with no HTTP/React rendering in the way.
//
//   npm run perf:server -- [--runs 20 | --runs=20] [--json]
//
// Read-only by construction: the connection is opened with better-sqlite3's
// `readonly` + `fileMustExist` (so a missing dev.db fails instead of being
// created empty), and PRAGMA query_only is set on top. The query-event
// check below only *reports* a write after the fact — Prisma emits query
// events once a statement has already executed, so it can't abort one; the
// two connection-level guards are what actually prevent writes.

const WARMUP_RUNS = 3;
const JSON_OUT = ".perf/server-profile.json";

type Case = { name: string; run: () => Promise<unknown> };

async function main() {
  const { runs, json } = parseProfileArgs(process.argv.slice(2));
  const sqlitePath = assertLocalSqliteUrl(
    process.env.DATABASE_URL,
    process.cwd(),
  );

  // Same adapter as app/db.server.ts, but opened read-only (and never
  // creating a missing file), plus query events for counting.
  const db = new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url: process.env.DATABASE_URL!,
      readonly: true,
      fileMustExist: true,
    }),
    log: [{ emit: "event", level: "query" }],
  });

  let queryCount = 0;
  db.$on("query", (event) => {
    // Fires after execution: this flags a write that slipped past the
    // read-only connection, it doesn't prevent it.
    if (isWriteStatement(event.query)) {
      throw new Error(
        `Write statement during a read-only profile: ${event.query}`,
      );
    }
    queryCount++;
  });

  try {
    await db.$executeRawUnsafe("PRAGMA query_only = ON");

    // Same selection as lighthouserc.cjs's heaviestSeededWorkId().
    const [heaviest] = await db.$queryRawUnsafe<
      { id: string; paragraphs: number | bigint }[]
    >(
      `SELECT w.id AS id, COUNT(p.id) AS paragraphs
         FROM Work w
         JOIN Chapter c ON c.workId = w.id
         JOIN Section s ON s.chapterId = c.id
         JOIN Paragraph p ON p.sectionId = s.id
        GROUP BY w.id
        ORDER BY paragraphs DESC, w.id ASC
        LIMIT 1`,
    );
    if (!heaviest) {
      throw new Error(
        `No works in ${sqlitePath}. Run the migrate/seed/ingest bootstrap from lighthouserc.cjs's header first.`,
      );
    }
    const workId = heaviest.id;

    // prisma/seed.ts's local user, or whoever owns/was granted the work.
    const reader = await db.user.findFirstOrThrow({
      where: {
        OR: [
          { works: { some: { id: workId } } },
          { workGrants: { some: { workId } } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    const chapters = await db.chapter.findMany({
      where: { workId },
      orderBy: { ordinal: "asc" },
      select: {
        sections: { orderBy: { ordinal: "asc" }, select: { id: true } },
      },
    });
    const midSectionId =
      chapters[Math.floor(chapters.length / 2)]?.sections[0]?.id ?? null;

    const structural = await db.paragraph.findMany({
      where: { section: { chapter: { workId } } },
      orderBy: { globalOrdinal: "asc" },
      select: { id: true, globalOrdinal: true, wordCount: true },
    });
    const midOrdinal =
      structural[Math.floor(structural.length / 2)]?.globalOrdinal ?? 1;
    const initialRange = selectInitialContentWindow(
      structural,
      1,
      DEFAULT_CONTENT_BYTE_BUDGET,
      true,
    );
    const midRange = selectInitialContentWindow(
      structural,
      midOrdinal,
      DEFAULT_CONTENT_BYTE_BUDGET,
      true,
    );
    if (!initialRange || !midRange)
      throw new Error(`${workId} has no paragraphs`);

    const userId = reader.id;
    const cases: Case[] = [
      { name: "fetchShelf", run: () => fetchShelf(db, userId) },
      {
        name: "fetchReadPageData (start)",
        run: () => fetchReadPageData(db, userId, workId, null),
      },
      {
        name: "fetchReadPageData (mid-book section)",
        run: () => fetchReadPageData(db, userId, workId, midSectionId),
      },
      {
        name: `fetchContentWindow (initial, ¶${initialRange.minGlobalOrdinal}–${initialRange.maxGlobalOrdinal})`,
        run: () => fetchContentWindow(db, workId, initialRange),
      },
      {
        name: `fetchContentWindow (mid, ¶${midRange.minGlobalOrdinal}–${midRange.maxGlobalOrdinal})`,
        run: () => fetchContentWindow(db, workId, midRange),
      },
      {
        name: 'searchMentionCandidates ("the")',
        run: () =>
          searchMentionCandidates(db, {
            userId,
            workId,
            query: "the",
            bookmarkGlobalOrdinal: midOrdinal,
          }),
      },
      {
        name: "fetchCommonplaceShelf",
        run: () => fetchCommonplaceShelf(db, userId, null),
      },
    ];

    const results: { name: string; summary: Summary }[] = [];
    for (const c of cases) {
      for (let i = 0; i < WARMUP_RUNS; i++) await c.run();
      const samples: Sample[] = [];
      for (let i = 0; i < runs; i++) {
        queryCount = 0;
        const start = performance.now();
        const result = await c.run();
        const ms = performance.now() - start;
        // Serialization is outside the timed span — it's measuring the
        // payload, not React Router's own encoding cost.
        const bytes = Buffer.byteLength(JSON.stringify(result));
        samples.push({ ms, bytes, queries: queryCount });
      }
      results.push({ name: c.name, summary: summarize(samples) });
    }

    const meta = {
      date: new Date().toISOString(),
      node: process.version,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      cpu: os.cpus()[0]?.model ?? "unknown",
      database: path.relative(process.cwd(), sqlitePath),
      workId,
      paragraphs: Number(heaviest.paragraphs),
      runs,
      warmupRuns: WARMUP_RUNS,
    };

    console.log(renderMarkdown(meta, results));

    if (json) {
      mkdirSync(path.dirname(JSON_OUT), { recursive: true });
      writeFileSync(
        JSON_OUT,
        JSON.stringify({ meta, results }, null, 2) + "\n",
      );
      console.error(`Wrote ${JSON_OUT}`);
    }
  } finally {
    await db.$disconnect();
  }
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`;
}

function renderMarkdown(
  meta: Record<string, string | number>,
  results: { name: string; summary: Summary }[],
): string {
  const lines = [
    `Server profile — ${meta.workId} (${meta.paragraphs} paragraphs), ${meta.runs} runs after ${meta.warmupRuns} warmup, node ${meta.node}, ${meta.cpu}`,
    "",
    "| fetch | p50 | p95 | max | payload | SQL queries |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...results.map(({ name, summary: s }) => {
      const flag = s.queries > N_PLUS_ONE_QUERY_THRESHOLD ? " ⚠️" : "";
      return `| ${name} | ${s.p50Ms.toFixed(2)}ms | ${s.p95Ms.toFixed(2)}ms | ${s.maxMs.toFixed(2)}ms | ${formatBytes(s.bytes)} | ${s.queries}${flag} |`;
    }),
    "",
    `⚠️ = more than ${N_PLUS_ONE_QUERY_THRESHOLD} SQL statements in one call — check whether the count scales with the data (N+1) or is a fixed fan-out (Prisma's per-relation queries, chunked IN lists).`,
  ];
  return lines.join("\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
