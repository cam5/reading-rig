import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { getOrCreateRigSession, replaceRigSession, withRigSessionRecovery } from "./rigSession";
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

describe("replaceRigSession", () => {
  let db: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  it("points the existing row at a freshly created Anthropic session", async () => {
    const user = await db.user.create({ data: {} });
    const { workId } = await seedWork(db, { userId: user.id, paragraphs: ["First."] });
    const existing = await db.rigSession.create({
      data: { userId: user.id, workId, anthropicSessionId: "sesn_gone", agentVersion: "1" },
    });
    const createAnthropicSession = vi.fn().mockResolvedValue({ anthropicSessionId: "sesn_fresh" });

    const replaced = await replaceRigSession(db, existing, createAnthropicSession);

    expect(replaced.id).toBe(existing.id);
    expect(replaced.anthropicSessionId).toBe("sesn_fresh");
    expect(createAnthropicSession).toHaveBeenCalledTimes(1);

    const row = await db.rigSession.findUnique({ where: { id: existing.id } });
    expect(row?.anthropicSessionId).toBe("sesn_fresh");
  });
});

describe("withRigSessionRecovery", () => {
  let db: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  async function createRigSession(db: PrismaClient) {
    const user = await db.user.create({ data: {} });
    const { workId } = await seedWork(db, { userId: user.id, paragraphs: ["First."] });
    return db.rigSession.create({
      data: { userId: user.id, workId, anthropicSessionId: "sesn_original", agentVersion: "1" },
    });
  }

  it("returns the operation's result on the first try, without touching the row", async () => {
    const rigSession = await createRigSession(db);
    const createAnthropicSession = vi.fn();
    const operation = vi.fn().mockResolvedValue("ok");

    const result = await withRigSessionRecovery(
      db,
      rigSession,
      createAnthropicSession,
      () => true,
      operation,
    );

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledWith(rigSession);
    expect(createAnthropicSession).not.toHaveBeenCalled();
  });

  it("rethrows immediately when the failure isn't a session-not-found error", async () => {
    const rigSession = await createRigSession(db);
    const createAnthropicSession = vi.fn();
    const operation = vi.fn().mockRejectedValue(new Error("network blip"));

    await expect(
      withRigSessionRecovery(db, rigSession, createAnthropicSession, () => false, operation),
    ).rejects.toThrow("network blip");
    expect(createAnthropicSession).not.toHaveBeenCalled();
  });

  it("replaces the session and retries once when the operation reports session-not-found", async () => {
    const rigSession = await createRigSession(db);
    const createAnthropicSession = vi.fn().mockResolvedValue({ anthropicSessionId: "sesn_fresh" });
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("Session not found: sesn_original"))
      .mockResolvedValueOnce("recovered");

    const result = await withRigSessionRecovery(
      db,
      rigSession,
      createAnthropicSession,
      () => true,
      operation,
    );

    expect(result).toBe("recovered");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(operation.mock.calls[1][0]).toMatchObject({ anthropicSessionId: "sesn_fresh" });

    const row = await db.rigSession.findUnique({ where: { id: rigSession.id } });
    expect(row?.anthropicSessionId).toBe("sesn_fresh");
  });

  it("does not retry a second time if the retried operation fails again", async () => {
    const rigSession = await createRigSession(db);
    const createAnthropicSession = vi.fn().mockResolvedValue({ anthropicSessionId: "sesn_fresh" });
    const operation = vi.fn().mockRejectedValue(new Error("Session not found: still gone"));

    await expect(
      withRigSessionRecovery(db, rigSession, createAnthropicSession, () => true, operation),
    ).rejects.toThrow("Session not found: still gone");

    expect(operation).toHaveBeenCalledTimes(2);
    expect(createAnthropicSession).toHaveBeenCalledTimes(1);
  });
});
