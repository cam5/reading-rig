import type { PrismaClient } from "../../../generated/prisma/client";
import type { ParsedWork } from "./types";

/**
 * Upserts a parsed work into Prisma. Chapter and Section ids are simple
 * deterministic composites (not content-addressed hashes like a
 * paragraph's) — nothing anchors to them directly the way a highlight
 * anchors to a paragraph, so a readable, stable string is enough to keep
 * re-ingesting idempotent.
 *
 * The whole tree is written inside one $transaction: a book can be
 * thousands of paragraphs deep, and without this, a crash partway through
 * (an unexpected paragraph shape, the process getting killed) would leave
 * a Work row with a random prefix of its chapters persisted — readable,
 * wrong, and with nothing to say it's incomplete. A rolled-back ingest is
 * just a retry; a half-ingested one is a silent corruption.
 */
export async function persistWork(
  db: PrismaClient,
  ownerId: string,
  work: ParsedWork,
): Promise<{
  workId: string;
  chapterCount: number;
  paragraphCount: number;
  warnings: string[];
}> {
  let paragraphCount = 0;
  // null, not "[]" — a Work with nothing ambiguous should read as "no
  // warnings" straightforwardly, not as an empty-but-present JSON array.
  const ingestWarnings =
    work.warnings.length > 0 ? JSON.stringify(work.warnings) : null;

  await db.$transaction(async (tx) => {
    await tx.work.upsert({
      where: { id: work.id },
      update: { title: work.title, author: work.author, ingestWarnings },
      create: {
        id: work.id,
        ownerId,
        title: work.title,
        author: work.author,
        ingestWarnings,
      },
    });

    for (const chapter of work.chapters) {
      const chapterId = `${work.id}::c${chapter.ordinal}`;
      await tx.chapter.upsert({
        where: { id: chapterId },
        update: { label: chapter.label, ordinal: chapter.ordinal },
        create: {
          id: chapterId,
          workId: work.id,
          label: chapter.label,
          ordinal: chapter.ordinal,
        },
      });

      for (const section of chapter.sections) {
        const sectionId = `${chapterId}::s${section.ordinal}`;
        await tx.section.upsert({
          where: { id: sectionId },
          update: { label: section.label, ordinal: section.ordinal },
          create: {
            id: sectionId,
            chapterId,
            label: section.label,
            ordinal: section.ordinal,
          },
        });

        for (const paragraph of section.paragraphs) {
          const fields =
            paragraph.kind === "prose"
              ? {
                  html: paragraph.html,
                  text: paragraph.text,
                  wordCount: paragraph.wordCount,
                  isBlockquote: paragraph.isBlockquote,
                  kind: "prose" as const,
                }
              : {
                  html: "",
                  text: "",
                  wordCount: 0,
                  isBlockquote: false,
                  kind: "sceneBreak" as const,
                };

          await tx.paragraph.upsert({
            where: { id: paragraph.id },
            update: {
              ordinal: paragraph.ordinal,
              globalOrdinal: paragraph.globalOrdinal,
              ...fields,
            },
            create: {
              id: paragraph.id,
              sectionId,
              ordinal: paragraph.ordinal,
              globalOrdinal: paragraph.globalOrdinal,
              ...fields,
            },
          });
          paragraphCount += 1;
        }
      }
    }
  });

  return {
    workId: work.id,
    chapterCount: work.chapters.length,
    paragraphCount,
    warnings: work.warnings,
  };
}
