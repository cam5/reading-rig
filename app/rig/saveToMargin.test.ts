import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { saveToMargin } from "./saveToMargin";
import { createTestDb } from "./tools/testDb";
import { seedWork } from "./tools/testFixtures";

/**
 * Proves the Entry-creation half of #29's "save to margin" is correct
 * against a real database — the same discipline #25's tool-handler tests
 * use (createTestDb, seedWork), and the honest substitute for a route-
 * level test: vitest.config.ts's `include` doesn't cover app/routes/**
 * yet, and there is no live Rig session in this environment to produce a
 * real answer to save in the first place (no ANTHROPIC_API_KEY, no
 * READING_RIG_ENVIRONMENT_ID — see rig.tsx's own NOTE). The payload below
 * is a synthetic, hand-written stand-in for what a real Rig answer would
 * look like — this test verifies the write path is correct, not that a
 * live model produced this text.
 */
describe("saveToMargin", () => {
  let db: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  it("creates a rig-origin Entry carrying posture, anchor, and contextSnapshot", async () => {
    const user = await db.user.create({ data: {} });
    const { paragraphIds } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["A commodity appears, at first sight, a very trivial thing."],
    });

    const contextSnapshot = {
      passageLabel: "§1 ¶1",
      items: [{ id: "entry-1", label: "your note at §1 ¶1" }],
      statement: "In view: this passage (§1 ¶1) and your note at §1 ¶1. Nothing past your bookmark.",
    };

    const entry = await saveToMargin(db, {
      userId: user.id,
      body: "Not in the wood, and not in the labour either — both are ordinary.",
      posture: "interrogate",
      anchorParagraphId: paragraphIds[0],
      contextSnapshot,
    });

    expect(entry.origin).toBe("rig");
    expect(entry.posture).toBe("interrogate");
    expect(entry.body).toBe("Not in the wood, and not in the labour either — both are ordinary.");
    expect(entry.anchorParagraphId).toBe(paragraphIds[0]);
    expect(entry.contextSnapshot).toEqual(contextSnapshot);

    // Round-trips through the exact query read.tsx's loader uses to build
    // "Today's page" — the real proof that a rig entry sits in the same
    // table, reachable the same way, as a hand entry.
    const reloaded = await db.paragraph.findUniqueOrThrow({
      where: { id: paragraphIds[0] },
      include: { entries: true },
    });
    expect(reloaded.entries).toHaveLength(1);
    expect(reloaded.entries[0].origin).toBe("rig");
  });

  it("supports an empty contextSnapshot without throwing", async () => {
    const user = await db.user.create({ data: {} });
    const { paragraphIds } = await seedWork(db, { userId: user.id, paragraphs: ["Only one paragraph."] });

    const entry = await saveToMargin(db, {
      userId: user.id,
      body: "A plain answer.",
      posture: "recap",
      anchorParagraphId: paragraphIds[0],
      contextSnapshot: {},
    });

    expect(entry.contextSnapshot).toEqual({});
  });

  it("lets two Rig entries anchor to the same paragraph, same as two hand notes could", async () => {
    const user = await db.user.create({ data: {} });
    const { paragraphIds } = await seedWork(db, { userId: user.id, paragraphs: ["One paragraph, read twice."] });

    await saveToMargin(db, {
      userId: user.id,
      body: "First answer.",
      posture: "interrogate",
      anchorParagraphId: paragraphIds[0],
      contextSnapshot: {},
    });
    await saveToMargin(db, {
      userId: user.id,
      body: "Second answer, a different posture.",
      posture: "steelman",
      anchorParagraphId: paragraphIds[0],
      contextSnapshot: {},
    });

    const entries = await db.entry.findMany({ where: { anchorParagraphId: paragraphIds[0] } });
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.posture).sort()).toEqual(["interrogate", "steelman"]);
  });
});
