import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../../generated/prisma/client";
import { getPassage } from "./getPassage";
import { createTestDb } from "./testDb";
import { seedWork } from "./testFixtures";

describe("getPassage", () => {
  let db: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  it("returns the paragraph with enough context to derive a locator", async () => {
    const user = await db.user.create({ data: {} });
    const { workId, paragraphIds } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["First.", "Second.", "Third."],
    });
    await db.readingPosition.create({
      data: { userId: user.id, workId, paragraphId: paragraphIds[2] },
    });

    const result = await getPassage(db, {
      userId: user.id,
      paragraphId: paragraphIds[0],
    });

    expect(result).not.toBeNull();
    expect(result?.text).toBe("First.");
    expect(result?.locator).toBe("§1 ¶1");
    expect(result?.workTitle).toBe("Test Work");
  });

  it("returns null for a nonexistent paragraph id", async () => {
    const user = await db.user.create({ data: {} });

    const result = await getPassage(db, {
      userId: user.id,
      paragraphId: "no-such-paragraph",
    });

    expect(result).toBeNull();
  });

  it("returns null for a paragraph belonging to another user's work", async () => {
    const owner = await db.user.create({ data: {} });
    const stranger = await db.user.create({ data: {} });
    const { paragraphIds } = await seedWork(db, {
      userId: owner.id,
      paragraphs: ["Not yours."],
    });

    const result = await getPassage(db, {
      userId: stranger.id,
      paragraphId: paragraphIds[0],
    });

    expect(result).toBeNull();
  });

  it("returns null once the paragraph is past the reader's bookmark", async () => {
    const user = await db.user.create({ data: {} });
    const { workId, paragraphIds } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["First.", "Second.", "Third."],
    });
    await db.readingPosition.create({
      data: { userId: user.id, workId, paragraphId: paragraphIds[0] },
    });

    const result = await getPassage(db, {
      userId: user.id,
      paragraphId: paragraphIds[2],
    });

    expect(result).toBeNull();
  });

  it("returns the passage that sits exactly at the bookmark", async () => {
    const user = await db.user.create({ data: {} });
    const { workId, paragraphIds } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["First.", "Second."],
    });
    await db.readingPosition.create({
      data: { userId: user.id, workId, paragraphId: paragraphIds[1] },
    });

    const result = await getPassage(db, {
      userId: user.id,
      paragraphId: paragraphIds[1],
    });

    expect(result?.text).toBe("Second.");
  });

  it("treats no bookmark at all as globalOrdinal 0 — nothing has been read yet", async () => {
    const user = await db.user.create({ data: {} });
    const { paragraphIds } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["First."],
    });

    const result = await getPassage(db, {
      userId: user.id,
      paragraphId: paragraphIds[0],
    });

    expect(result).toBeNull();
  });
});
