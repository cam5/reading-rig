import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../../generated/prisma/client";
import { createTestDb } from "../../rig/tools/testDb";
import { seedWork } from "../../rig/tools/testFixtures";
import {
  assertWorkReadableBy,
  fetchOwnedWork,
} from "./assertWorkReadableBy.server";

// Read-only against one seeded database, so one copy for the whole file.
let db: PrismaClient;
let ownedWorkId: string;
let othersWorkId: string;
let grantedWorkId: string;

beforeAll(async () => {
  db = createTestDb();
  for (const id of ["reader", "other", "lender"]) {
    await db.user.create({ data: { id, email: `${id}@test.example` } });
  }
  ownedWorkId = (await seedWork(db, { userId: "reader", paragraphs: ["One."] }))
    .workId;
  othersWorkId = (await seedWork(db, { userId: "other", paragraphs: ["Two."] }))
    .workId;
  grantedWorkId = (
    await seedWork(db, { userId: "lender", paragraphs: ["Three."] })
  ).workId;
  await db.workGrant.create({
    data: { userId: "reader", workId: grantedWorkId },
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("assertWorkReadableBy", () => {
  it("resolves for a work the user owns", async () => {
    await expect(
      assertWorkReadableBy(db, "reader", ownedWorkId),
    ).resolves.toBeUndefined();
  });

  it("resolves for a work granted (not owned) to the user", async () => {
    await expect(
      assertWorkReadableBy(db, "reader", grantedWorkId),
    ).resolves.toBeUndefined();
  });

  it("throws a 404 Response for a work that belongs to someone else", async () => {
    const thrown = await assertWorkReadableBy(db, "reader", othersWorkId).catch(
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);
  });

  it("throws 404 for a work id that doesn't exist", async () => {
    await expect(
      assertWorkReadableBy(db, "reader", "no-such-work"),
    ).rejects.toMatchObject({ status: 404 });
  });

  // The point of sharing one status: a probing request can't tell "exists,
  // not yours" from "doesn't exist" by the response.
  it("answers someone else's work and a missing one identically", async () => {
    const [foreign, missing] = await Promise.all(
      [othersWorkId, "no-such-work"].map(async (workId) => {
        const response = (await assertWorkReadableBy(
          db,
          "reader",
          workId,
        ).catch((error: unknown) => error)) as Response;
        return { status: response.status, body: await response.text() };
      }),
    );
    expect(foreign).toEqual(missing);
  });

  it("doesn't let a grant to one user open the work to another", async () => {
    await expect(
      assertWorkReadableBy(db, "other", grantedWorkId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("doesn't let an owner's access leak the other way through a grant", async () => {
    // "lender" granted their work to "reader" — that says nothing about
    // "reader"'s own shelf.
    await expect(
      assertWorkReadableBy(db, "lender", ownedWorkId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("throws 404 for a user id that doesn't exist", async () => {
    await expect(
      assertWorkReadableBy(db, "nobody", ownedWorkId),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("fetchOwnedWork", () => {
  it("returns the row for a work the user owns", async () => {
    await expect(
      fetchOwnedWork(db, "reader", ownedWorkId),
    ).resolves.toMatchObject({
      id: ownedWorkId,
      ownerId: "reader",
      title: "Test Work",
    });
  });

  it("returns the row for a granted work, still owned by its lender", async () => {
    await expect(
      fetchOwnedWork(db, "reader", grantedWorkId),
    ).resolves.toMatchObject({ id: grantedWorkId, ownerId: "lender" });
  });

  it("throws 404 for a work that belongs to someone else", async () => {
    await expect(
      fetchOwnedWork(db, "reader", othersWorkId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("throws 404 for a work id that doesn't exist", async () => {
    await expect(
      fetchOwnedWork(db, "reader", "no-such-work"),
    ).rejects.toMatchObject({ status: 404 });
  });
});
