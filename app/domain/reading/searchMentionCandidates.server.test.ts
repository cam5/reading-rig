import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../../generated/prisma/client";
import { createTestDb } from "../../rig/tools/testDb";
import { seedWork } from "../../rig/tools/testFixtures";
import { searchMentionCandidates } from "./searchMentionCandidates.server";

describe("searchMentionCandidates", () => {
  let db: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  it("ranks matches closest-to-bookmark first, not in reading order", async () => {
    const user = await db.user.create({ data: {} });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: [
        "A whale swims far off.", // globalOrdinal 1
        "A whale breaches nearby.", // globalOrdinal 2
        "Nothing here.", // globalOrdinal 3 — the bookmark
      ],
    });

    const results = await searchMentionCandidates(db, {
      userId: user.id,
      workId,
      query: "whale",
      bookmarkGlobalOrdinal: 3,
    });

    expect(results.map((r) => r.text)).toEqual(["A whale breaches nearby.", "A whale swims far off."]);
  });

  it("returns the paragraphs closest to the bookmark for a blank query, unlike search_shelf", async () => {
    const user = await db.user.create({ data: {} });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["First.", "Second.", "Third."],
    });

    const results = await searchMentionCandidates(db, { userId: user.id, workId, query: "", bookmarkGlobalOrdinal: 3 });

    expect(results.map((r) => r.text)).toEqual(["Third.", "Second.", "First."]);
  });

  it("respects the limit", async () => {
    const user = await db.user.create({ data: {} });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["A whale.", "A whale.", "A whale.", "A whale."],
    });

    const results = await searchMentionCandidates(db, {
      userId: user.id,
      workId,
      query: "whale",
      bookmarkGlobalOrdinal: 4,
      limit: 2,
    });

    expect(results).toHaveLength(2);
  });

  it("matches case-insensitively", async () => {
    const user = await db.user.create({ data: {} });
    const { workId } = await seedWork(db, { userId: user.id, paragraphs: ["The Whale surfaces at dawn."] });

    const results = await searchMentionCandidates(db, {
      userId: user.id,
      workId,
      query: "whale",
      bookmarkGlobalOrdinal: 1,
    });

    expect(results).toHaveLength(1);
  });

  it("does not return a paragraph past the bookmark, even though it matches the query", async () => {
    const user = await db.user.create({ data: {} });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["The whale surfaces at dawn.", "Nothing about the query here.", "The whale dives again, far later."],
    });

    const results = await searchMentionCandidates(db, {
      userId: user.id,
      workId,
      query: "whale",
      bookmarkGlobalOrdinal: 2,
    });

    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("The whale surfaces at dawn.");
  });

  it("does not return a match from another user's work, even with the right workId", async () => {
    const owner = await db.user.create({ data: {} });
    const stranger = await db.user.create({ data: {} });
    const { workId } = await seedWork(db, { userId: owner.id, paragraphs: ["The whale surfaces at dawn."] });

    const results = await searchMentionCandidates(db, {
      userId: stranger.id,
      workId,
      query: "whale",
      bookmarkGlobalOrdinal: 1,
    });

    expect(results).toEqual([]);
  });
});
