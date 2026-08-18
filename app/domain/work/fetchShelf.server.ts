import type { PrismaClient } from "../../../generated/prisma/client";
import { workAccessWhere } from "./workAccessWhere.server";

/**
 * The reader's shelf: every Work they own or were granted, per
 * workAccessWhere. Shared by home.tsx's page loader and
 * api.v1.home.tsx — coverMediaType only, not coverImage itself, same
 * reasoning as read.tsx's own `select` (see that loader's comment): the
 * actual cover bytes are fetched per-work via /cover/*, not inlined here.
 */
export async function fetchShelf(
  db: Pick<PrismaClient, "work">,
  userId: string,
) {
  return db.work.findMany({
    where: workAccessWhere(userId),
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, author: true, coverMediaType: true },
  });
}
