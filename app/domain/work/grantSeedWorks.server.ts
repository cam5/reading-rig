import type { PrismaClient } from "../../../generated/prisma/client";

/**
 * Grants a user every seed-library Work (isSeedWork: true — the handful of
 * public-domain books ingested once under a library account and meant for
 * every shelf, see scripts/seedLibrary.ts) it doesn't already have a grant
 * for. Called from auth.verify.tsx on every sign-in, not just the first —
 * that route does a `user.upsert`, so this has to be safe to re-run against
 * an existing user. `workGrant.createMany`'s `skipDuplicates` isn't
 * supported on the SQLite driver adapter this app uses, so idempotency is
 * per-row `upsert` against the `(userId, workId)` unique constraint instead
 * of one bulk insert.
 */
export async function grantSeedWorks(
  db: Pick<PrismaClient, "work" | "workGrant">,
  userId: string,
): Promise<void> {
  const seedWorks = await db.work.findMany({
    where: { isSeedWork: true },
    select: { id: true },
  });

  for (const { id: workId } of seedWorks) {
    await db.workGrant.upsert({
      where: { userId_workId: { userId, workId } },
      create: { userId, workId },
      update: {},
    });
  }
}
