import type { EntryOrigin, Posture, PrismaClient, ThreadSuggestedBy } from "../../../generated/prisma/client";
import { formatLocator } from "../../domain/locator";

export type ListThreadsInput = {
  userId: string;
};

export type ThreadEntrySummary = {
  entryId: string;
  origin: EntryOrigin;
  posture?: Posture;
  body: string;
  workId: string;
  workTitle: string;
  locator: string;
};

export type ThreadWithEntries = {
  threadId: string;
  title: string;
  suggestedBy: ThreadSuggestedBy;
  /** In ordinal order — a thread reads back out as a sequence (3b "unrolls"
   * it), the same discipline commonplace.$entryId.tsx's loader follows. */
  entries: ThreadEntrySummary[];
};

/**
 * Every thread that has at least one entry belonging to this user, each
 * with its member entries in ordinal order. Mirrors
 * commonplace.$entryId.tsx's loader, which does the identical
 * threadEntry -> entry -> anchorParagraph -> ... walk for one thread at a
 * time; this handler is the same query widened to "every thread".
 *
 * A thread has no userId of its own — ownership only exists transitively,
 * through its entries' anchor paragraphs — so both the thread filter and
 * the nested entries list are scoped by that same chain, the way every
 * other handler in this directory scopes by userId.
 */
export async function listThreads(db: PrismaClient, { userId }: ListThreadsInput): Promise<ThreadWithEntries[]> {
  const ownedByUser = { anchorParagraph: { section: { chapter: { work: { ownerId: userId } } } } } as const;

  const threads = await db.thread.findMany({
    where: { threadEntries: { some: { entry: ownedByUser } } },
    orderBy: { createdAt: "asc" },
    include: {
      threadEntries: {
        where: { entry: ownedByUser },
        orderBy: { ordinal: "asc" },
        include: {
          entry: {
            include: {
              anchorParagraph: {
                include: { section: { include: { chapter: { include: { work: true } } } } },
              },
            },
          },
        },
      },
    },
  });

  return threads.map((thread) => ({
    threadId: thread.id,
    title: thread.title,
    suggestedBy: thread.suggestedBy,
    entries: thread.threadEntries.map(({ entry }) => {
      const paragraph = entry.anchorParagraph;
      const section = paragraph.section;
      const chapter = section.chapter;
      const work = chapter.work;
      return {
        entryId: entry.id,
        origin: entry.origin,
        posture: entry.posture ?? undefined,
        body: entry.body,
        workId: work.id,
        workTitle: work.title,
        locator: formatLocator({ sectionLabel: String(section.ordinal), paragraphOrdinal: paragraph.ordinal }),
      };
    }),
  }));
}
