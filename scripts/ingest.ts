import "dotenv/config";
import { readFileSync } from "node:fs";
import { shutdownAnalytics, track } from "../app/analytics.server";
import { parseEpub } from "../app/domain/epub/parseEpub";
import { persistWork } from "../app/domain/epub/persistWork.server";
import { requireUser } from "../app/user.server";
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
    const user = await requireUser(db);
    const source = readFileSync(path);
    const startedAt = Date.now();
    const work = parseEpub(source);
    const result = await persistWork(db, user.id, work);
    // Parse plus persist — what "ingesting this book took a while" would
    // actually mean to someone waiting on it. The file read is left out;
    // it isn't the part that gets slower as a book gets longer.
    const durationMs = Date.now() - startedAt;
    await track(
      {
        name: "epub_ingested",
        workId: result.workId,
        title: work.title,
        chapterCount: result.chapterCount,
        paragraphCount: result.paragraphCount,
        footnoteCount: result.footnoteCount,
        durationMs,
        warningCount: result.warnings.length,
        sourceBytes: source.byteLength,
      },
      // A CLI has no requireUser() request seam to reach through, but it
      // resolves the same single user the same way — so the same
      // distinct_id.
      { distinctId: user.id },
    );
    console.log(
      `Ingested "${work.title}" -> ${result.workId} ` +
        `(${result.chapterCount} chapters, ${result.paragraphCount} paragraphs, ${result.footnoteCount} footnotes)`,
    );
    if (result.warnings.length > 0) {
      console.warn(`${result.warnings.length} thing(s) to check:`);
      for (const warning of result.warnings) console.warn(`  - ${warning}`);
    }
  } finally {
    // No request lifecycle to hang a flush off: this process exits the
    // moment main() resolves, and an event still sitting in the client's
    // queue would go with it. A no-op when no key is set.
    await shutdownAnalytics();
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
