import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { getOrCreateRigSession } from "./rigSession";
import { createTestDb } from "./tools/testDb";
import { seedWork } from "./tools/testFixtures";

describe("getOrCreateRigSession", () => {
  let db: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  it("creates a new RigSession on first open, calling out to Anthropic exactly once", async () => {
    const user = await db.user.create({ data: {} });
    const { workId } = await seedWork(db, { userId: user.id, paragraphs: ["First."] });
    const createAnthropicSession = vi.fn().mockResolvedValue({ anthropicSessionId: "sesn_new" });

    const session = await getOrCreateRigSession(
      db,
      { userId: user.id, workId, agentVersion: "3" },
      createAnthropicSession,
    );

    expect(session.anthropicSessionId).toBe("sesn_new");
    expect(session.agentVersion).toBe("3");
    expect(createAnthropicSession).toHaveBeenCalledTimes(1);

    const row = await db.rigSession.findUnique({ where: { userId_workId: { userId: user.id, workId } } });
    expect(row?.anthropicSessionId).toBe("sesn_new");
  });

  it("resumes the existing RigSession on return, without calling Anthropic again", async () => {
    const user = await db.user.create({ data: {} });
    const { workId } = await seedWork(db, { userId: user.id, paragraphs: ["First."] });
    await db.rigSession.create({
      data: { userId: user.id, workId, anthropicSessionId: "sesn_existing", agentVersion: "1" },
    });
    const createAnthropicSession = vi.fn().mockResolvedValue({ anthropicSessionId: "sesn_should_not_be_used" });

    const session = await getOrCreateRigSession(
      db,
      { userId: user.id, workId, agentVersion: "2" },
      createAnthropicSession,
    );

    expect(session.anthropicSessionId).toBe("sesn_existing");
    // agentVersion is not rewritten on resume — the row IS the resumption,
    // untouched by whatever version the agent happens to be at today.
    expect(session.agentVersion).toBe("1");
    expect(createAnthropicSession).not.toHaveBeenCalled();
  });

  it("keeps one RigSession per (user, work) — a different work for the same user gets its own row", async () => {
    const user = await db.user.create({ data: {} });
    const first = await seedWork(db, { userId: user.id, paragraphs: ["First."] });
    const createAnthropicSession = vi
      .fn()
      .mockResolvedValueOnce({ anthropicSessionId: "sesn_a" })
      .mockResolvedValueOnce({ anthropicSessionId: "sesn_b" });

    // A second work for the same user, seeded by hand rather than
    // seedSecondWork (which keys off the same userId as seedWork and would
    // collide) — a plain second Work row is all this test needs.
    const secondWorkId = `${first.workId}-second`;
    await db.work.create({ data: { id: secondWorkId, ownerId: user.id, title: "Second Work" } });

    const sessionA = await getOrCreateRigSession(
      db,
      { userId: user.id, workId: first.workId, agentVersion: "1" },
      createAnthropicSession,
    );
    const sessionB = await getOrCreateRigSession(
      db,
      { userId: user.id, workId: secondWorkId, agentVersion: "1" },
      createAnthropicSession,
    );

    expect(sessionA.anthropicSessionId).toBe("sesn_a");
    expect(sessionB.anthropicSessionId).toBe("sesn_b");
    expect(createAnthropicSession).toHaveBeenCalledTimes(2);
  });

  it("falls back to the winning row instead of erroring when a race creates a duplicate", async () => {
    const user = await db.user.create({ data: {} });
    const { workId } = await seedWork(db, { userId: user.id, paragraphs: ["First."] });

    // Simulate a second caller winning the race: by the time this call's
    // createAnthropicSession resolves, another RigSession row already
    // exists for (userId, workId) — the @@unique constraint would reject
    // this call's own create.
    const createAnthropicSession = vi.fn().mockImplementation(async () => {
      await db.rigSession.create({
        data: { userId: user.id, workId, anthropicSessionId: "sesn_winner", agentVersion: "1" },
      });
      return { anthropicSessionId: "sesn_loser" };
    });

    const session = await getOrCreateRigSession(db, { userId: user.id, workId, agentVersion: "1" }, createAnthropicSession);

    expect(session.anthropicSessionId).toBe("sesn_winner");
    const rows = await db.rigSession.findMany({ where: { userId: user.id, workId } });
    expect(rows).toHaveLength(1);
  });
});
