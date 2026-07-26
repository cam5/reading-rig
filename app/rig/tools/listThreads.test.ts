import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../../generated/prisma/client";
import { listThreads } from "./listThreads";
import { createTestDb } from "./testDb";
import { seedWork } from "./testFixtures";

describe("listThreads", () => {
  let db: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  it("returns a thread's entries in ordinal order, not creation order", async () => {
    const user = await db.user.create({ data: {} });
    const { paragraphIds } = await seedWork(db, { userId: user.id, paragraphs: ["First.", "Second."] });

    const entryA = await db.entry.create({
      data: { origin: "hand", body: "Written second, ordinal 0.", anchorParagraphId: paragraphIds[0], contextSnapshot: {} },
    });
    const entryB = await db.entry.create({
      data: { origin: "hand", body: "Written first, ordinal 1.", anchorParagraphId: paragraphIds[1], contextSnapshot: {} },
    });

    const thread = await db.thread.create({ data: { title: "A thread", suggestedBy: "hand" } });
    // Created out of ordinal order on purpose: entryB (ordinal 1) inserted
    // before entryA (ordinal 0) — the query must sort by ordinal, not by
    // ThreadEntry creation order.
    await db.threadEntry.create({ data: { threadId: thread.id, entryId: entryB.id, ordinal: 1 } });
    await db.threadEntry.create({ data: { threadId: thread.id, entryId: entryA.id, ordinal: 0 } });

    const threads = await listThreads(db, { userId: user.id });

    expect(threads).toHaveLength(1);
    expect(threads[0].entries.map((e) => e.body)).toEqual(["Written second, ordinal 0.", "Written first, ordinal 1."]);
  });

  it("carries the thread's title and suggestedBy, and each entry's locator", async () => {
    const user = await db.user.create({ data: {} });
    const { paragraphIds } = await seedWork(db, { userId: user.id, paragraphs: ["A passage."] });
    const entry = await db.entry.create({
      data: { origin: "hand", body: "A note.", anchorParagraphId: paragraphIds[0], contextSnapshot: {} },
    });
    const thread = await db.thread.create({ data: { title: "Machines and men", suggestedBy: "rig" } });
    await db.threadEntry.create({ data: { threadId: thread.id, entryId: entry.id, ordinal: 0 } });

    const [result] = await listThreads(db, { userId: user.id });

    expect(result.title).toBe("Machines and men");
    expect(result.suggestedBy).toBe("rig");
    expect(result.entries[0].locator).toBe("§1 ¶1");
  });

  it("does not return a thread with no entries belonging to this user", async () => {
    const owner = await db.user.create({ data: {} });
    const stranger = await db.user.create({ data: {} });
    const { paragraphIds } = await seedWork(db, { userId: owner.id, paragraphs: ["Not yours."] });
    const entry = await db.entry.create({
      data: { origin: "hand", body: "Someone else's note.", anchorParagraphId: paragraphIds[0], contextSnapshot: {} },
    });
    const thread = await db.thread.create({ data: { title: "Not yours either", suggestedBy: "hand" } });
    await db.threadEntry.create({ data: { threadId: thread.id, entryId: entry.id, ordinal: 0 } });

    const threads = await listThreads(db, { userId: stranger.id });

    expect(threads).toEqual([]);
  });

  it("returns an empty list when there are no threads at all", async () => {
    const user = await db.user.create({ data: {} });

    const threads = await listThreads(db, { userId: user.id });

    expect(threads).toEqual([]);
  });
});
