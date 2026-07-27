import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { parseEpub } from "../app/domain/epub/parseEpub";
import { persistWork } from "../app/domain/epub/persistWork.server";
import { PrismaClient } from "../generated/prisma/client";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npm run ingest <path.epub>");
    process.exitCode = 1;
    return;
  }

  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
  const db = new PrismaClient({ adapter });

  try {
    const user = await db.user.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const work = parseEpub(readFileSync(path));
    const result = await persistWork(db, user.id, work);
    console.log(
      `Ingested "${work.title}" -> ${result.workId} ` +
        `(${result.chapterCount} chapters, ${result.paragraphCount} paragraphs)`,
    );
    if (result.warnings.length > 0) {
      console.warn(`${result.warnings.length} thing(s) to check:`);
      for (const warning of result.warnings) console.warn(`  - ${warning}`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
