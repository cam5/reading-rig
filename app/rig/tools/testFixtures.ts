import type { PrismaClient } from "../../../generated/prisma/client";

export type SeededWork = {
  workId: string;
  chapterId: string;
  sectionId: string;
  paragraphIds: string[];
};

/**
 * Minimal, deliberately: one work -> one chapter -> one section -> N
 * paragraphs, in reading order. Enough for every handler test in this
 * directory without each one re-deriving the same nested creates.
 *
 * Paragraph `i` (0-based) gets ordinal/globalOrdinal `i + 1` — a single
 * section means ordinal and globalOrdinal coincide, which is fine here:
 * nothing in this directory tests multi-section global-ordinal assignment
 * (parseEpub.test.ts already covers that, in the ingest layer where it's
 * actually computed).
 */
export async function seedWork(
  db: PrismaClient,
  { userId, paragraphs }: { userId: string; paragraphs: string[] },
): Promise<SeededWork> {
  const workId = `work-${userId}`;
  await db.work.create({ data: { id: workId, ownerId: userId, title: "Test Work", author: "Test Author" } });

  const chapterId = `${workId}::c1`;
  await db.chapter.create({ data: { id: chapterId, workId, label: "Chapter 1", ordinal: 1 } });

  const sectionId = `${chapterId}::s1`;
  await db.section.create({ data: { id: sectionId, chapterId, label: "1", ordinal: 1 } });

  const paragraphIds: string[] = [];
  for (const [index, text] of paragraphs.entries()) {
    const id = `${sectionId}::p${index + 1}`;
    await db.paragraph.create({
      data: { id, sectionId, html: `<p>${text}</p>`, text, ordinal: index + 1, globalOrdinal: index + 1 },
    });
    paragraphIds.push(id);
  }

  return { workId, chapterId, sectionId, paragraphIds };
}

/**
 * A second work for a user who already has one from `seedWork` — that
 * helper keys the work's id off `userId`, so a second call for the same
 * user would collide on it. Used by tests asserting a handler scopes
 * correctly *across* a shelf of more than one book.
 */
export async function seedSecondWork(
  db: PrismaClient,
  { userId, paragraphs }: { userId: string; paragraphs: string[] },
): Promise<SeededWork> {
  const workId = `work-${userId}-second`;
  await db.work.create({ data: { id: workId, ownerId: userId, title: "Second Test Work", author: "Test Author" } });

  const chapterId = `${workId}::c1`;
  await db.chapter.create({ data: { id: chapterId, workId, label: "Chapter 1", ordinal: 1 } });

  const sectionId = `${chapterId}::s1`;
  await db.section.create({ data: { id: sectionId, chapterId, label: "1", ordinal: 1 } });

  const paragraphIds: string[] = [];
  for (const [index, text] of paragraphs.entries()) {
    const id = `${sectionId}::p${index + 1}`;
    await db.paragraph.create({
      data: { id, sectionId, html: `<p>${text}</p>`, text, ordinal: index + 1, globalOrdinal: index + 1 },
    });
    paragraphIds.push(id);
  }

  return { workId, chapterId, sectionId, paragraphIds };
}
