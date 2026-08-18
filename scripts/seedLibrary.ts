import "dotenv/config";
import { createHash } from "node:crypto";
import { parseEpub } from "../app/domain/epub/parseEpub";
import { persistWork } from "../app/domain/epub/persistWork.server";
import { grantSeedWorks } from "../app/domain/work/grantSeedWorks.server";
import { createStandaloneDb } from "./lib/db";
import { SEED_LIBRARY, type SeedBookSource } from "./lib/seedLibraryManifest";

// Owns the seed Works — a fixed, non-signup account rather than "whichever
// user happens to be oldest" (scripts/ingest.ts's fallback), so the seed
// library's ownership doesn't shift under it if that changes.
const LIBRARY_ACCOUNT_EMAIL = "library@reading-rig.internal";

async function fetchPinned(source: SeedBookSource): Promise<Buffer> {
  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(
      `${source.title}: fetch failed (${response.status} ${response.statusText})`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== source.sha256) {
    throw new Error(
      `${source.title}: downloaded content doesn't match the pinned sha256 ` +
        `(expected ${source.sha256}, got ${actualHash}). Standard Ebooks may ` +
        `have revised this edition — review the change before updating the ` +
        `pin in scripts/lib/seedLibraryManifest.ts.`,
    );
  }
  return bytes;
}

async function main() {
  const db = createStandaloneDb();

  try {
    const libraryUser = await db.user.upsert({
      where: { email: LIBRARY_ACCOUNT_EMAIL },
      update: {},
      create: { email: LIBRARY_ACCOUNT_EMAIL },
    });

    for (const source of SEED_LIBRARY) {
      const bytes = await fetchPinned(source);
      const work = parseEpub(bytes);
      const result = await persistWork(db, libraryUser.id, work);
      // persistWork's upsert only sets isSeedWork on create, never update —
      // set it explicitly every run so this is idempotent regardless.
      await db.work.update({
        where: { id: result.workId },
        data: { isSeedWork: true },
      });
      console.log(
        `Seeded "${work.title}" -> ${result.workId} ` +
          `(${result.chapterCount} chapters, ${result.paragraphCount} paragraphs)`,
      );
      if (result.warnings.length > 0) {
        console.warn(`  ${result.warnings.length} thing(s) to check:`);
        for (const warning of result.warnings) console.warn(`    - ${warning}`);
      }
    }

    // Backfill every user that already exists — including, outside real
    // production, the seeded dev user requireUserId falls back to (see
    // app/auth/session.server.ts) — since it never goes through
    // auth.verify.tsx's own grantSeedWorks call. Every future signup gets
    // the seed shelf from that call instead.
    const users = await db.user.findMany({ select: { id: true } });
    for (const user of users) {
      await grantSeedWorks(db, user.id);
    }
    console.log(
      `Granted the seed library to ${users.length} existing user(s).`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
