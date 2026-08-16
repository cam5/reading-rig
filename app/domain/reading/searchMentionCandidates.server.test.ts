import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../../generated/prisma/client";
import { createTestDb } from "../../rig/tools/testDb";
import { seedWork } from "../../rig/tools/testFixtures";
import {
  type MentionCandidate,
  searchMentionCandidates,
} from "./searchMentionCandidates.server";

/** Every candidate's displayed text, whichever kind it is — keeps the
 * assertions below reading the same way they did before notes existed. */
function texts(results: MentionCandidate[]): string[] {
  return results.map((r) =>
    r.kind === "paragraph" ? r.passage.text : r.note.body,
  );
}

describe("searchMentionCandidates", () => {
  let db: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  it("ranks matches closest-to-bookmark first, not in reading order", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
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

    expect(texts(results)).toEqual([
      "A whale breaches nearby.",
      "A whale swims far off.",
    ]);
  });

  it("returns the paragraphs closest to the bookmark for a blank query, unlike search_shelf", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["First.", "Second.", "Third."],
    });

    const results = await searchMentionCandidates(db, {
      userId: user.id,
      workId,
      query: "",
      bookmarkGlobalOrdinal: 3,
    });

    expect(texts(results)).toEqual(["Third.", "Second.", "First."]);
  });

  it("respects the limit", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
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
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["The Whale surfaces at dawn."],
    });

    const results = await searchMentionCandidates(db, {
      userId: user.id,
      workId,
      query: "whale",
      bookmarkGlobalOrdinal: 1,
    });

    expect(results).toHaveLength(1);
  });

  it("returns a paragraph past the bookmark too, ranked behind closer in-bookmark matches", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: [
        "The whale surfaces at dawn.",
        "Nothing about the query here.",
        "The whale dives again, far later.",
      ],
    });

    const results = await searchMentionCandidates(db, {
      userId: user.id,
      workId,
      query: "whale",
      bookmarkGlobalOrdinal: 2,
    });

    // globalOrdinal 1 is one paragraph behind the bookmark; globalOrdinal 3
    // is one paragraph ahead — equidistant, so the behind match (fetched
    // first) leads via stable sort.
    expect(texts(results)).toEqual([
      "The whale surfaces at dawn.",
      "The whale dives again, far later.",
    ]);
  });

  it("ranks purely by distance from the bookmark, not by which side of it a match falls on", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: [
        "A whale far behind.", // globalOrdinal 1 — distance 3
        "Nothing.", // globalOrdinal 2
        "Nothing.", // globalOrdinal 3
        "Nothing.", // globalOrdinal 4 — the bookmark
        "A whale just ahead.", // globalOrdinal 5 — distance 1
      ],
    });

    const results = await searchMentionCandidates(db, {
      userId: user.id,
      workId,
      query: "whale",
      bookmarkGlobalOrdinal: 4,
    });

    expect(texts(results)).toEqual([
      "A whale just ahead.",
      "A whale far behind.",
    ]);
  });

  it("does not return a match from another user's work, even with the right workId", async () => {
    const owner = await db.user.create({
      data: { email: "owner@test.example" },
    });
    const stranger = await db.user.create({
      data: { email: "stranger@test.example" },
    });
    const { workId } = await seedWork(db, {
      userId: owner.id,
      paragraphs: ["The whale surfaces at dawn."],
    });

    const results = await searchMentionCandidates(db, {
      userId: stranger.id,
      workId,
      query: "whale",
      bookmarkGlobalOrdinal: 1,
    });

    expect(results).toEqual([]);
  });

  it("interleaves notes with paragraphs, ranked by their anchor's closeness to the bookmark", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId, paragraphIds } = await seedWork(db, {
      userId: user.id,
      paragraphs: [
        "A whale swims far off.", // globalOrdinal 1
        "Nothing about the query.", // globalOrdinal 2 — note anchors here
        "A whale breaches nearby.", // globalOrdinal 3 — the bookmark
      ],
    });
    await db.entry.create({
      data: {
        userId: user.id,
        origin: "hand",
        body: "This is where the whale first appears.",
        anchorParagraphId: paragraphIds[1],
        contextSnapshot: {},
      },
    });

    const results = await searchMentionCandidates(db, {
      userId: user.id,
      workId,
      query: "whale",
      bookmarkGlobalOrdinal: 3,
    });

    expect(results.map((r) => r.kind)).toEqual([
      "paragraph",
      "note",
      "paragraph",
    ]);
    expect(texts(results)).toEqual([
      "A whale breaches nearby.",
      "This is where the whale first appears.",
      "A whale swims far off.",
    ]);
  });

  it("returns a note anchored past the bookmark too, since it matches the query", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId, paragraphIds } = await seedWork(db, {
      userId: user.id,
      paragraphs: [
        "Before the bookmark.",
        "At the bookmark.",
        "Past the bookmark.",
      ],
    });
    await db.entry.create({
      data: {
        userId: user.id,
        origin: "hand",
        body: "A whale note written past the bookmark.",
        anchorParagraphId: paragraphIds[2],
        contextSnapshot: {},
      },
    });

    const results = await searchMentionCandidates(db, {
      userId: user.id,
      workId,
      query: "whale",
      bookmarkGlobalOrdinal: 2,
    });

    expect(results).toHaveLength(1);
    expect(texts(results)).toEqual(["A whale note written past the bookmark."]);
  });

  it("does not return a note from another user's work, even with the right workId", async () => {
    const owner = await db.user.create({
      data: { email: "owner@test.example" },
    });
    const stranger = await db.user.create({
      data: { email: "stranger@test.example" },
    });
    const { workId, paragraphIds } = await seedWork(db, {
      userId: owner.id,
      paragraphs: ["A whale surfaces."],
    });
    await db.entry.create({
      data: {
        userId: owner.id,
        origin: "hand",
        body: "A whale note.",
        anchorParagraphId: paragraphIds[0],
        contextSnapshot: {},
      },
    });

    const results = await searchMentionCandidates(db, {
      userId: stranger.id,
      workId,
      query: "whale",
      bookmarkGlobalOrdinal: 1,
    });

    expect(results).toEqual([]);
  });
});
