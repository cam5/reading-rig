import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { dispatchTool } from "./dispatchTool";
import { createTestDb } from "./tools/testDb";
import { seedSecondWork, seedWork } from "./tools/testFixtures";

describe("dispatchTool", () => {
  let db: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  describe("get_passage", () => {
    it("dispatches to getPassage and returns a JSON-encoded Passage on success", async () => {
      const user = await db.user.create({ data: {} });
      const { workId, paragraphIds } = await seedWork(db, { userId: user.id, paragraphs: ["First.", "Second."] });
      await db.readingPosition.create({ data: { userId: user.id, workId, paragraphId: paragraphIds[1] } });

      const outcome = await dispatchTool(
        "get_passage",
        { paragraphId: paragraphIds[0] },
        { db, userId: user.id, workId },
      );

      expect(outcome.isError).toBe(false);
      expect(JSON.parse(outcome.text)).toMatchObject({ text: "First.", locator: "§1 ¶1" });
    });

    it("returns a tool error, not a thrown exception, for a missing paragraphId", async () => {
      const user = await db.user.create({ data: {} });
      const { workId } = await seedWork(db, { userId: user.id, paragraphs: ["First."] });

      const outcome = await dispatchTool("get_passage", {}, { db, userId: user.id, workId });

      expect(outcome.isError).toBe(true);
      expect(outcome.text).toMatch(/paragraphId/);
    });

    it("returns a tool error rather than the literal string 'null' when the passage is out of reach", async () => {
      const user = await db.user.create({ data: {} });
      const { workId, paragraphIds } = await seedWork(db, { userId: user.id, paragraphs: ["First.", "Second."] });
      await db.readingPosition.create({ data: { userId: user.id, workId, paragraphId: paragraphIds[0] } });

      const outcome = await dispatchTool(
        "get_passage",
        { paragraphId: paragraphIds[1] },
        { db, userId: user.id, workId },
      );

      expect(outcome.isError).toBe(true);
      expect(outcome.text).not.toBe("null");
    });

    it("cannot be used to reach another user's paragraph by passing its id", async () => {
      const owner = await db.user.create({ data: {} });
      const stranger = await db.user.create({ data: {} });
      const { workId, paragraphIds } = await seedWork(db, { userId: owner.id, paragraphs: ["Not yours."] });

      const outcome = await dispatchTool(
        "get_passage",
        { paragraphId: paragraphIds[0] },
        { db, userId: stranger.id, workId },
      );

      expect(outcome.isError).toBe(true);
    });
  });

  describe("get_surrounding", () => {
    it("defaults before/after to 0 rather than erroring when they're omitted", async () => {
      const user = await db.user.create({ data: {} });
      const { workId, paragraphIds } = await seedWork(db, {
        userId: user.id,
        paragraphs: ["First.", "Second.", "Third."],
      });
      await db.readingPosition.create({ data: { userId: user.id, workId, paragraphId: paragraphIds[2] } });

      const outcome = await dispatchTool(
        "get_surrounding",
        { paragraphId: paragraphIds[1] },
        { db, userId: user.id, workId },
      );

      expect(outcome.isError).toBe(false);
      const parsed = JSON.parse(outcome.text);
      expect(parsed.before).toEqual([]);
      expect(parsed.after).toEqual([]);
      expect(parsed.target.text).toBe("Second.");
    });

    it("respects the bookmark boundary on the after side", async () => {
      const user = await db.user.create({ data: {} });
      const { workId, paragraphIds } = await seedWork(db, {
        userId: user.id,
        paragraphs: ["First.", "Second.", "Third."],
      });
      await db.readingPosition.create({ data: { userId: user.id, workId, paragraphId: paragraphIds[1] } });

      const outcome = await dispatchTool(
        "get_surrounding",
        { paragraphId: paragraphIds[0], before: 1, after: 5 },
        { db, userId: user.id, workId },
      );

      const parsed = JSON.parse(outcome.text);
      expect(parsed.after.map((p: { text: string }) => p.text)).toEqual(["Second."]);
    });
  });

  describe("search_shelf", () => {
    it("resolves the bookmark itself rather than trusting it from the tool call's input", async () => {
      const user = await db.user.create({ data: {} });
      const { workId, paragraphIds } = await seedWork(db, {
        userId: user.id,
        paragraphs: ["The whale surfaces.", "The whale dives, long after the bookmark."],
      });
      await db.readingPosition.create({ data: { userId: user.id, workId, paragraphId: paragraphIds[0] } });

      // A tool call can't smuggle in a bookmark that reaches further than
      // the reader's real one, even by naming one explicitly — dispatchTool
      // doesn't read a bookmarkGlobalOrdinal out of the model's own input.
      const outcome = await dispatchTool(
        "search_shelf",
        { query: "whale", bookmarkGlobalOrdinal: 999 },
        { db, userId: user.id, workId },
      );

      const parsed = JSON.parse(outcome.text) as Array<{ text: string }>;
      expect(parsed).toHaveLength(1);
      expect(parsed[0].text).toBe("The whale surfaces.");
    });

    it("returns a tool error for a missing query", async () => {
      const user = await db.user.create({ data: {} });
      const { workId } = await seedWork(db, { userId: user.id, paragraphs: ["First."] });

      const outcome = await dispatchTool("search_shelf", {}, { db, userId: user.id, workId });

      expect(outcome.isError).toBe(true);
    });
  });

  describe("list_my_notes", () => {
    it("defaults to the whole shelf (every work), not just the session's own work", async () => {
      // Deliberate: listMyNotes' documented default is "whole shelf" — the
      // Connect posture needs to draw a line to another book on the
      // reader's shelf, so dispatchTool doesn't narrow an omitted workId
      // down to ctx.workId.
      const user = await db.user.create({ data: {} });
      const { workId, paragraphIds } = await seedWork(db, { userId: user.id, paragraphs: ["First."] });
      const second = await seedSecondWork(db, { userId: user.id, paragraphs: ["Elsewhere."] });
      await db.entry.create({
        data: {
          userId: user.id,
          origin: "hand",
          body: "A note on the first book.",
          anchorParagraphId: paragraphIds[0],
          contextSnapshot: {},
        },
      });
      await db.entry.create({
        data: {
          userId: user.id,
          origin: "hand",
          body: "A note on the second book.",
          anchorParagraphId: second.paragraphIds[0],
          contextSnapshot: {},
        },
      });

      const outcome = await dispatchTool("list_my_notes", {}, { db, userId: user.id, workId });

      const parsed = JSON.parse(outcome.text) as Array<{ body: string }>;
      expect(parsed.map((n) => n.body)).toEqual(["A note on the second book.", "A note on the first book."]);
    });

    it("scopes to a work explicitly named in the tool call's input", async () => {
      const user = await db.user.create({ data: {} });
      const { workId, paragraphIds } = await seedWork(db, { userId: user.id, paragraphs: ["First."] });
      const second = await seedSecondWork(db, { userId: user.id, paragraphs: ["Elsewhere."] });
      await db.entry.create({
        data: {
          userId: user.id,
          origin: "hand",
          body: "A note on the first book.",
          anchorParagraphId: paragraphIds[0],
          contextSnapshot: {},
        },
      });
      await db.entry.create({
        data: {
          userId: user.id,
          origin: "hand",
          body: "A note on the second book.",
          anchorParagraphId: second.paragraphIds[0],
          contextSnapshot: {},
        },
      });

      const outcome = await dispatchTool("list_my_notes", { workId }, { db, userId: user.id, workId });

      const parsed = JSON.parse(outcome.text) as Array<{ body: string }>;
      expect(parsed.map((n) => n.body)).toEqual(["A note on the first book."]);
    });
  });

  describe("get_source_excerpt", () => {
    it("comes back as a tool error, not a thrown exception — not implemented until M4", async () => {
      const user = await db.user.create({ data: {} });
      const { workId } = await seedWork(db, { userId: user.id, paragraphs: ["First."] });

      const outcome = await dispatchTool("get_source_excerpt", { sourceId: "src_1" }, { db, userId: user.id, workId });

      expect(outcome.isError).toBe(true);
      expect(outcome.text).toMatch(/no Source model/);
    });

    it("returns a tool error for a missing sourceId", async () => {
      const user = await db.user.create({ data: {} });
      const { workId } = await seedWork(db, { userId: user.id, paragraphs: ["First."] });

      const outcome = await dispatchTool("get_source_excerpt", {}, { db, userId: user.id, workId });

      expect(outcome.isError).toBe(true);
      expect(outcome.text).toMatch(/sourceId/);
    });
  });

  describe("list_threads", () => {
    it("dispatches with no input required", async () => {
      const user = await db.user.create({ data: {} });
      const { workId } = await seedWork(db, { userId: user.id, paragraphs: ["First."] });

      const outcome = await dispatchTool("list_threads", {}, { db, userId: user.id, workId });

      expect(outcome.isError).toBe(false);
      expect(JSON.parse(outcome.text)).toEqual([]);
    });
  });

  describe("unknown tool", () => {
    it("returns a tool error naming the unknown tool rather than throwing", async () => {
      const user = await db.user.create({ data: {} });
      const { workId } = await seedWork(db, { userId: user.id, paragraphs: ["First."] });

      const outcome = await dispatchTool("delete_everything", {}, { db, userId: user.id, workId });

      expect(outcome.isError).toBe(true);
      expect(outcome.text).toMatch(/Unknown tool: delete_everything/);
    });
  });
});
