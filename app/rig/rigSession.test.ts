import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  createRigSession,
  getOrCreateActiveRigSession,
  getRigSessionById,
  listRigSessions,
  replaceRigSession,
  withRigSessionRecovery,
} from "./rigSession";
import { createTestDb } from "./tools/testDb";
import { seedWork } from "./tools/testFixtures";

describe("createRigSession", () => {
  let db: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  it("always creates a new row, even when one already exists for this (user, work)", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["First."],
    });
    await db.rigSession.create({
      data: {
        userId: user.id,
        workId,
        anthropicSessionId: "sesn_existing",
        agentVersion: "1",
      },
    });
    const createAnthropicSession = vi
      .fn()
      .mockResolvedValue({ anthropicSessionId: "sesn_new" });

    const session = await createRigSession(
      db,
      { userId: user.id, workId, agentVersion: "2" },
      createAnthropicSession,
    );

    expect(session.anthropicSessionId).toBe("sesn_new");
    expect(session.agentVersion).toBe("2");
    expect(createAnthropicSession).toHaveBeenCalledTimes(1);

    const rows = await db.rigSession.findMany({
      where: { userId: user.id, workId },
    });
    expect(rows).toHaveLength(2);
  });
});

describe("listRigSessions", () => {
  let db: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  it("returns every session for (user, work), most recent first", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["First."],
    });
    const older = await db.rigSession.create({
      data: {
        userId: user.id,
        workId,
        anthropicSessionId: "sesn_older",
        agentVersion: "1",
      },
    });
    // SQLite's DateTime resolution can tie within the same millisecond —
    // nudge the second row's createdAt forward explicitly rather than
    // relying on wall-clock time passing between the two creates.
    const newer = await db.rigSession.create({
      data: {
        userId: user.id,
        workId,
        anthropicSessionId: "sesn_newer",
        agentVersion: "1",
        createdAt: new Date(older.createdAt.getTime() + 1000),
      },
    });

    const sessions = await listRigSessions(db, { userId: user.id, workId });

    expect(sessions.map((s) => s.id)).toEqual([newer.id, older.id]);
  });

  it("doesn't return another user's or another work's sessions", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const otherUser = await db.user.create({
      data: { email: "otherUser@test.example" },
    });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["First."],
    });
    const secondWorkId = `${workId}-second`;
    await db.work.create({
      data: { id: secondWorkId, ownerId: user.id, title: "Second Work" },
    });

    await db.rigSession.create({
      data: {
        userId: otherUser.id,
        workId,
        anthropicSessionId: "sesn_other_user",
        agentVersion: "1",
      },
    });
    await db.rigSession.create({
      data: {
        userId: user.id,
        workId: secondWorkId,
        anthropicSessionId: "sesn_other_work",
        agentVersion: "1",
      },
    });
    const mine = await db.rigSession.create({
      data: {
        userId: user.id,
        workId,
        anthropicSessionId: "sesn_mine",
        agentVersion: "1",
      },
    });

    const sessions = await listRigSessions(db, { userId: user.id, workId });

    expect(sessions.map((s) => s.id)).toEqual([mine.id]);
  });
});

describe("getOrCreateActiveRigSession", () => {
  let db: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  it("creates a new RigSession when this (user, work) has none yet", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["First."],
    });
    const createAnthropicSession = vi
      .fn()
      .mockResolvedValue({ anthropicSessionId: "sesn_new" });

    const session = await getOrCreateActiveRigSession(
      db,
      { userId: user.id, workId, agentVersion: "3" },
      createAnthropicSession,
    );

    expect(session.anthropicSessionId).toBe("sesn_new");
    expect(session.agentVersion).toBe("3");
    expect(createAnthropicSession).toHaveBeenCalledTimes(1);
  });

  it("resumes the most recently created RigSession, without calling Anthropic again", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["First."],
    });
    const older = await db.rigSession.create({
      data: {
        userId: user.id,
        workId,
        anthropicSessionId: "sesn_older",
        agentVersion: "1",
      },
    });
    const newer = await db.rigSession.create({
      data: {
        userId: user.id,
        workId,
        anthropicSessionId: "sesn_newer",
        agentVersion: "1",
        createdAt: new Date(older.createdAt.getTime() + 1000),
      },
    });
    const createAnthropicSession = vi
      .fn()
      .mockResolvedValue({ anthropicSessionId: "sesn_should_not_be_used" });

    const session = await getOrCreateActiveRigSession(
      db,
      { userId: user.id, workId, agentVersion: "2" },
      createAnthropicSession,
    );

    expect(session.id).toBe(newer.id);
    expect(session.anthropicSessionId).toBe("sesn_newer");
    expect(createAnthropicSession).not.toHaveBeenCalled();
  });

  it("keeps sessions scoped per (user, work) — a different work for the same user gets its own", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const first = await seedWork(db, {
      userId: user.id,
      paragraphs: ["First."],
    });
    const createAnthropicSession = vi
      .fn()
      .mockResolvedValueOnce({ anthropicSessionId: "sesn_a" })
      .mockResolvedValueOnce({ anthropicSessionId: "sesn_b" });

    const secondWorkId = `${first.workId}-second`;
    await db.work.create({
      data: { id: secondWorkId, ownerId: user.id, title: "Second Work" },
    });

    const sessionA = await getOrCreateActiveRigSession(
      db,
      { userId: user.id, workId: first.workId, agentVersion: "1" },
      createAnthropicSession,
    );
    const sessionB = await getOrCreateActiveRigSession(
      db,
      { userId: user.id, workId: secondWorkId, agentVersion: "1" },
      createAnthropicSession,
    );

    expect(sessionA.anthropicSessionId).toBe("sesn_a");
    expect(sessionB.anthropicSessionId).toBe("sesn_b");
    expect(createAnthropicSession).toHaveBeenCalledTimes(2);
  });
});

describe("getRigSessionById", () => {
  let db: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  it("returns the session when it belongs to this (user, work)", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["First."],
    });
    const created = await db.rigSession.create({
      data: {
        userId: user.id,
        workId,
        anthropicSessionId: "sesn_mine",
        agentVersion: "1",
      },
    });

    const session = await getRigSessionById(db, {
      userId: user.id,
      workId,
      sessionId: created.id,
    });

    expect(session?.id).toBe(created.id);
  });

  it("returns null for a session id that doesn't exist", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["First."],
    });

    const session = await getRigSessionById(db, {
      userId: user.id,
      workId,
      sessionId: "not_a_real_id",
    });

    expect(session).toBeNull();
  });

  it("returns null for a session that belongs to a different user", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const otherUser = await db.user.create({
      data: { email: "otherUser@test.example" },
    });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["First."],
    });
    const theirs = await db.rigSession.create({
      data: {
        userId: otherUser.id,
        workId,
        anthropicSessionId: "sesn_theirs",
        agentVersion: "1",
      },
    });

    const session = await getRigSessionById(db, {
      userId: user.id,
      workId,
      sessionId: theirs.id,
    });

    expect(session).toBeNull();
  });

  it("returns null for a session that belongs to a different work", async () => {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["First."],
    });
    const secondWorkId = `${workId}-second`;
    await db.work.create({
      data: { id: secondWorkId, ownerId: user.id, title: "Second Work" },
    });
    const otherWorkSession = await db.rigSession.create({
      data: {
        userId: user.id,
        workId: secondWorkId,
        anthropicSessionId: "sesn_other_work",
        agentVersion: "1",
      },
    });

    const session = await getRigSessionById(db, {
      userId: user.id,
      workId,
      sessionId: otherWorkSession.id,
    });

    expect(session).toBeNull();
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
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["First."],
    });
    const existing = await db.rigSession.create({
      data: {
        userId: user.id,
        workId,
        anthropicSessionId: "sesn_gone",
        agentVersion: "1",
      },
    });
    const createAnthropicSession = vi
      .fn()
      .mockResolvedValue({ anthropicSessionId: "sesn_fresh" });

    const replaced = await replaceRigSession(
      db,
      existing,
      createAnthropicSession,
    );

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

  async function seedRigSession(db: PrismaClient) {
    const user = await db.user.create({ data: { email: "user@test.example" } });
    const { workId } = await seedWork(db, {
      userId: user.id,
      paragraphs: ["First."],
    });
    return db.rigSession.create({
      data: {
        userId: user.id,
        workId,
        anthropicSessionId: "sesn_original",
        agentVersion: "1",
      },
    });
  }

  it("returns the operation's result on the first try, without touching the row", async () => {
    const rigSession = await seedRigSession(db);
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
    const rigSession = await seedRigSession(db);
    const createAnthropicSession = vi.fn();
    const operation = vi.fn().mockRejectedValue(new Error("network blip"));

    await expect(
      withRigSessionRecovery(
        db,
        rigSession,
        createAnthropicSession,
        () => false,
        operation,
      ),
    ).rejects.toThrow("network blip");
    expect(createAnthropicSession).not.toHaveBeenCalled();
  });

  it("replaces the session and retries once when the operation reports session-not-found", async () => {
    const rigSession = await seedRigSession(db);
    const createAnthropicSession = vi
      .fn()
      .mockResolvedValue({ anthropicSessionId: "sesn_fresh" });
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
    expect(operation.mock.calls[1][0]).toMatchObject({
      anthropicSessionId: "sesn_fresh",
    });

    const row = await db.rigSession.findUnique({
      where: { id: rigSession.id },
    });
    expect(row?.anthropicSessionId).toBe("sesn_fresh");
  });

  it("does not retry a second time if the retried operation fails again", async () => {
    const rigSession = await seedRigSession(db);
    const createAnthropicSession = vi
      .fn()
      .mockResolvedValue({ anthropicSessionId: "sesn_fresh" });
    const operation = vi
      .fn()
      .mockRejectedValue(new Error("Session not found: still gone"));

    await expect(
      withRigSessionRecovery(
        db,
        rigSession,
        createAnthropicSession,
        () => true,
        operation,
      ),
    ).rejects.toThrow("Session not found: still gone");

    expect(operation).toHaveBeenCalledTimes(2);
    expect(createAnthropicSession).toHaveBeenCalledTimes(1);
  });
});
