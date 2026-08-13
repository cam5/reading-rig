import { describe, expect, it } from "vitest";
import { getSourceExcerpt } from "./getSourceExcerpt";
import { createTestDb } from "./testDb";

describe("getSourceExcerpt", () => {
  it("fails loudly and names the gap, rather than faking a Source model that doesn't exist yet", async () => {
    const db = createTestDb();
    try {
      await expect(
        getSourceExcerpt(db, { userId: "u1", sourceId: "s1" }),
      ).rejects.toThrow(/Source model to query yet/);
    } finally {
      await db.$disconnect();
    }
  });

  it("points at the ticket that will give it a real implementation", async () => {
    const db = createTestDb();
    try {
      await expect(
        getSourceExcerpt(db, { userId: "u1", sourceId: "s1" }),
      ).rejects.toThrow(/M4's #23/);
    } finally {
      await db.$disconnect();
    }
  });
});
