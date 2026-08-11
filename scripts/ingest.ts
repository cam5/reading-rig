import "dotenv/config";
import { readFileSync } from "node:fs";
import { parseEpub } from "../app/domain/epub/parseEpub";
import { persistWork } from "../app/domain/epub/persistWork.server";
import { createStandaloneDb } from "./lib/db";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npm run ingest <path.epub>");
    process.exitCode = 1;
    return;
  }

  const db = createStandaloneDb();

  try {
    // No HTTP request here to pull a session from, so requireUser()
    // (app/user.server.ts) doesn't apply — a CLI ingest has to target an
    // owner directly. Falls back to the oldest account, the same "there's
    // only really one person running this" assumption requireUser() used
    // to make for every call site before real accounts existed.
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
