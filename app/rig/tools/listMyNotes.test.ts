import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../../generated/prisma/client";
import { listMyNotes } from "./listMyNotes";
import { createTestDb } from "./testDb";
import { seedSecondWork, seedWork } from "./testFixtures";

describe("listMyNotes", () => {
  let db: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  it("lists entries anchored anywhere on the user's shelf when no workId is given", async () => {
    const user = await db.user.create({ data: {} });
    const workA = await seedWork(db, { userId: user.id, paragraphs: ["From work A."] });
    const workB = await seedSecondWork(db, { userId: user.id, paragraphs: ["From work B."] });

    await db.entry.create({
      data: { origin: "hand", body: "A note on work A.", anchorParagraphId: workA.paragraphIds[0], contextSnapshot: {} },
    });
    await db.entry.create({
      data: { origin: "hand", body: "A note on work B.", anchorParagraphId: workB.paragraphIds[0], contextSnapshot: {} },
    });

    const notes = await listMyNotes(db, { userId: user.id });

    expect(notes.map((n) => n.body).sort()).toEqual(["A note on work A.", "A note on work B."]);
  });

  it("scopes to one work when workId is given", async () => {
    const user = await db.user.create({ data: {} });
    const workA = await seedWork(db, { userId: user.id, paragraphs: ["From work A."] });
    const workB = await seedSecondWork(db, { userId: user.id, paragraphs: ["From work B."] });

    await db.entry.create({
      data: { origin: "hand", body: "A note on work A.", anchorParagraphId: workA.paragraphIds[0], contextSnapshot: {} },
    });
    await db.entry.create({
      data: { origin: "hand", body: "A note on work B.", anchorParagraphId: workB.paragraphIds[0], contextSnapshot: {} },
    });

    const notes = await listMyNotes(db, { userId: user.id, workId: workA.workId });

    expect(notes).toHaveLength(1);
    expect(notes[0].body).toBe("A note on work A.");
  });

  it("carries origin, posture, and a derived locator", async () => {
    const user = await db.user.create({ data: {} });
    const { paragraphIds } = await seedWork(db, { userId: user.id, paragraphs: ["A passage worth pressing on."] });

    await db.entry.create({
      data: {
        origin: "rig",
        posture: "interrogate",
        body: "What does this assume?",
        anchorParagraphId: paragraphIds[0],
        contextSnapshot: {},
      },
    });

    const [note] = await listMyNotes(db, { userId: user.id });

    expect(note.origin).toBe("rig");
    expect(note.posture).toBe("interrogate");
    expect(note.locator).toBe("§1 ¶1");
  });

  it("does not return another user's notes", async () => {
    const owner = await db.user.create({ data: {} });
    const stranger = await db.user.create({ data: {} });
    const { paragraphIds } = await seedWork(db, { userId: owner.id, paragraphs: ["Not yours."] });
    await db.entry.create({
      data: { origin: "hand", body: "A private note.", anchorParagraphId: paragraphIds[0], contextSnapshot: {} },
    });

    const notes = await listMyNotes(db, { userId: stranger.id });

    expect(notes).toEqual([]);
  });
});
