import type { PrismaClient } from "../../../generated/prisma/client";
import type { ParsedWork } from "./types";

/**
 * Upserts a parsed work into Prisma. Chapter and Section ids are simple
 * deterministic composites (not content-addressed hashes like a
 * paragraph's) — nothing anchors to them directly the way a highlight
 * anchors to a paragraph, so a readable, stable string is enough to keep
 * re-ingesting idempotent.
 */
export async function persistWork(
  db: PrismaClient,
  userId: string,
  work: ParsedWork,
): Promise<{ workId: string; chapterCount: number; paragraphCount: number }> {
  let paragraphCount = 0;

  await db.work.upsert({
    where: { id: work.id },
    update: { title: work.title, author: work.author },
    create: { id: work.id, userId, title: work.title, author: work.author },
  });

  for (const chapter of work.chapters) {
    const chapterId = `${work.id}::c${chapter.ordinal}`;
    await db.chapter.upsert({
      where: { id: chapterId },
      update: { label: chapter.label, ordinal: chapter.ordinal },
      create: { id: chapterId, workId: work.id, label: chapter.label, ordinal: chapter.ordinal },
    });

    for (const section of chapter.sections) {
      const sectionId = `${chapterId}::s${section.ordinal}`;
      await db.section.upsert({
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
        await db.paragraph.upsert({
          where: { id: paragraph.id },
          update: {
            html: paragraph.html,
            text: paragraph.text,
            ordinal: paragraph.ordinal,
            globalOrdinal: paragraph.globalOrdinal,
          },
          create: {
            id: paragraph.id,
            sectionId,
            html: paragraph.html,
            text: paragraph.text,
            ordinal: paragraph.ordinal,
            globalOrdinal: paragraph.globalOrdinal,
          },
        });
        paragraphCount += 1;
      }
    }
  }

  return { workId: work.id, chapterCount: work.chapters.length, paragraphCount };
}
