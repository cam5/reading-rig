import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../../generated/prisma/client";
import { getSurrounding } from "./getSurrounding";
import { createTestDb } from "./testDb";
import { seedWork } from "./testFixtures";

describe("getSurrounding", () => {
  let db: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  it("returns the target plus the paragraphs immediately before and after it", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId, paragraphIds } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["One.", "Two.", "Three.", "Four.", "Five."],
    });
    await db.readingPosition.create({ data: { userId: user.id, workId, paragraphId: paragraphIds[4] } });

    const result = await getSurrounding(db, { userId: user.id, paragraphId: paragraphIds[2], before: 1, after: 1 });

    expect(result?.target.text).toBe("Three.");
    expect(result?.before.map((p) => p.text)).toEqual(["Two."]);
    expect(result?.after.map((p) => p.text)).toEqual(["Four."]);
  });

  it("clips the 'after' side at the bookmark, even when asked for more", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId, paragraphIds } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["One.", "Two.", "Three.", "Four.", "Five."],
    });
    // Bookmark sits right at paragraph 3 — only "Four." is left in view.
    await db.readingPosition.create({ data: { userId: user.id, workId, paragraphId: paragraphIds[2] } });

    const result = await getSurrounding(db, { userId: user.id, paragraphId: paragraphIds[2], before: 2, after: 3 });

    expect(result?.before.map((p) => p.text)).toEqual(["One.", "Two."]);
    expect(result?.after).toEqual([]);
  });

  it("does not need its own bookmark check on the 'before' side — it's always in bounds", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId, paragraphIds } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["One.", "Two.", "Three."],
    });
    await db.readingPosition.create({ data: { userId: user.id, workId, paragraphId: paragraphIds[1] } });

    const result = await getSurrounding(db, { userId: user.id, paragraphId: paragraphIds[1], before: 5, after: 0 });

    expect(result?.before.map((p) => p.text)).toEqual(["One."]);
  });

  it("returns null when the target itself is past the bookmark", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId, paragraphIds } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["One.", "Two.", "Three."],
    });
    await db.readingPosition.create({ data: { userId: user.id, workId, paragraphId: paragraphIds[0] } });

    const result = await getSurrounding(db, { userId: user.id, paragraphId: paragraphIds[2], before: 1, after: 1 });

    expect(result).toBeNull();
  });

  it("returns null for a paragraph belonging to another user's work", async () => {
    const owner = await db.user.create({ data: { email: "owner@test.example" } });
    const stranger = await db.user.create({ data: { email: "stranger@test.example" } });
    const { paragraphIds } = await seedWork(db, { userId: owner.id, paragraphs: ["Only mine."] });

    const result = await getSurrounding(db, { userId: stranger.id, paragraphId: paragraphIds[0], before: 1, after: 1 });

    expect(result).toBeNull();
  });
});
