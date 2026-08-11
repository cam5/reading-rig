import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../../generated/prisma/client";
import { searchShelf } from "./searchShelf";
import { createTestDb } from "./testDb";
import { seedWork } from "./testFixtures";

describe("searchShelf", () => {
  let db: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  // The issue's explicit "done when": a paragraph past the bookmark must
  // not come back even though it textually matches the query.
  it("does not return a paragraph past the bookmark, even though it matches the query", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId, paragraphIds } = await seedWork(db, {
      userId: user.id,
      paragraphs: [
        "The whale surfaces at dawn.", // globalOrdinal 1 — before the bookmark
        "Nothing about the query here.", // globalOrdinal 2 — at the bookmark
        "The whale dives again, long after you stopped reading.", // globalOrdinal 3 — past the bookmark
      ],
    });

    const results = await searchShelf(db, { userId: user.id, workId, query: "whale", bookmarkGlobalOrdinal: 2 });

    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("The whale surfaces at dawn.");
    expect(results.some((r) => r.globalOrdinal > 2)).toBe(false);
    expect(paragraphIds).toHaveLength(3); // sanity: the past-bookmark match really was seeded
  });

  it("returns a match that sits exactly at the bookmark", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["The whale surfaces at dawn."],
    });

    const results = await searchShelf(db, { userId: user.id, workId, query: "whale", bookmarkGlobalOrdinal: 1 });

    expect(results).toHaveLength(1);
  });

  it("returns paragraphs in reading order when more than one matches", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["A whale swims.", "A whale breaches.", "A whale dives."],
    });

    const results = await searchShelf(db, { userId: user.id, workId, query: "whale", bookmarkGlobalOrdinal: 3 });

    expect(results.map((r) => r.text)).toEqual(["A whale swims.", "A whale breaches.", "A whale dives."]);
  });

  it("returns nothing for a query that matches no paragraph", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId } = await seedWork(db, { userId: user.id, paragraphs: ["The whale surfaces at dawn."] });

    const results = await searchShelf(db, { userId: user.id, workId, query: "kraken", bookmarkGlobalOrdinal: 1 });

    expect(results).toEqual([]);
  });

  it("returns nothing for a blank query rather than every in-bookmark paragraph", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId } = await seedWork(db, { userId: user.id, paragraphs: ["The whale surfaces at dawn."] });

    const results = await searchShelf(db, { userId: user.id, workId, query: "   ", bookmarkGlobalOrdinal: 1 });

    expect(results).toEqual([]);
  });

  it("does not return a match from another user's work, even with the right workId", async () => {
    const owner = await db.user.create({ data: { email: "owner@test.example" } });
    const stranger = await db.user.create({ data: { email: "stranger@test.example" } });
    const { workId } = await seedWork(db, { userId: owner.id, paragraphs: ["The whale surfaces at dawn."] });

    const results = await searchShelf(db, { userId: stranger.id, workId, query: "whale", bookmarkGlobalOrdinal: 1 });

    expect(results).toEqual([]);
  });
});
