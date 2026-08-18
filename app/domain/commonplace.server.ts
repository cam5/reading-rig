import type { PrismaClient } from "../../generated/prisma/client";
import { workAccessWhere } from "./work/workAccessWhere.server";
import {
  bucketEntriesByWhen,
  formatEntryDate,
  provenanceCounts,
  splitAroundExcerpt,
} from "./commonplace";
import { describeAnchor, formatShelfLocator } from "./reading/anchorContext";

// `select`, not `include: { work: true }`, on every anchor->...->work walk
// below — the latter returns every scalar column on Work, which since #181
// means the cover image's raw bytes ride along too (see read.tsx's loader
// for the full story on why that's expensive). Nothing here reads more
// than id/title off Work.
const anchorInclude = {
  anchorParagraph: {
    include: {
      section: {
        include: {
          chapter: {
            include: { work: { select: { id: true, title: true } } },
          },
        },
      },
    },
  },
} as const;

/**
 * commonplace.tsx's page loader and api.v1.commonplace.tsx's JSON loader
 * share this — the whole shelf's worth of Entry rows (every Entry anchored
 * into a Work this user may access, owned or granted; see
 * workAccessWhere), shaped into the list + "currently selected entry's
 * margin" pair the commonplace view needs. `selectedEntryId` mirrors the
 * page's own `?entry=` — whichever entry the margin rail should show,
 * falling back to the most recent one.
 */
export async function fetchCommonplaceShelf(
  db: Pick<PrismaClient, "entry" | "work" | "readingPosition">,
  userId: string,
  selectedEntryId: string | null,
) {
  const entries = await db.entry.findMany({
    where: {
      anchorParagraph: {
        section: { chapter: { work: workAccessWhere(userId) } },
      },
    },
    orderBy: { createdAt: "desc" },
    include: anchorInclude,
  });

  const totalWorks = await db.work.count({ where: workAccessWhere(userId) });

  // The header's "Reading" tab has nowhere obvious to go from here — this
  // spans the whole shelf, not one work — so it resumes wherever the
  // bookmark last moved, falling back to the shelf's oldest work if
  // nothing's ever been read yet, and disappearing (no link) if the shelf
  // is empty.
  const lastPosition = await db.readingPosition.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { workId: true },
  });
  const oldestWork = lastPosition
    ? null
    : await db.work.findFirst({
        where: workAccessWhere(userId),
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
  const readingHref = lastPosition
    ? `/read/${lastPosition.workId}`
    : oldestWork
      ? `/read/${oldestWork.id}`
      : null;

  const when = bucketEntriesByWhen(entries, new Date());
  const provenance = provenanceCounts(entries);

  const selected = selectedEntryId
    ? (entries.find((e) => e.id === selectedEntryId) ?? entries[0])
    : entries[0];

  const margin = selected
    ? (() => {
        const excerpt =
          selected.contextSnapshot &&
          typeof selected.contextSnapshot === "object"
            ? (selected.contextSnapshot as { excerpt?: string }).excerpt
            : undefined;
        const context = splitAroundExcerpt(
          selected.anchorParagraph.text,
          excerpt,
        );
        // "within a page of it" — a proxy for physical proximity there's
        // no page-image concept to measure against: other entries anchored
        // in the same section.
        const nearbyCount = entries.filter(
          (e) =>
            e.id !== selected.id &&
            e.anchorParagraph.sectionId === selected.anchorParagraph.sectionId,
        ).length;
        return {
          workId: selected.anchorParagraph.section.chapter.workId,
          sectionId: selected.anchorParagraph.sectionId,
          context,
          nearbyCount,
        };
      })()
    : null;

  return {
    totalEntries: entries.length,
    totalWorks,
    readingHref,
    when,
    provenance,
    selectedEntryId: selected?.id ?? null,
    margin,
    entries: entries.map((entry) => {
      const excerpt =
        entry.contextSnapshot && typeof entry.contextSnapshot === "object"
          ? (entry.contextSnapshot as { excerpt?: string }).excerpt
          : undefined;
      return {
        id: entry.id,
        origin: entry.origin,
        body: entry.body,
        excerpt,
        date: formatEntryDate(entry.createdAt),
        // Work + chapter folded into the locator string itself — unlike
        // read.tsx's "Today's page", which only ever shows one work and
        // so only needs §4 ¶3, this spans the whole shelf and the context
        // line has to say which book.
        locator: formatShelfLocator(describeAnchor(entry.anchorParagraph)),
      };
    }),
  };
}

/** The main entry view wants a time as well as a date (3b: "12 Mar, 22:41")
 * — finer-grained than the shelf list, which only ever needs to
 * distinguish days. */
function formatEntryDateTime(date: Date): string {
  const day = formatEntryDate(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${day}, ${time}`;
}

// read.tsx's ?section= lands on the right section; the paragraph's own id
// is a real DOM id on its <p> (ReadingParagraph), so the fragment finishes
// the job of landing on the exact paragraph, not just its section — the
// web app's <ScrollRestoration> emulates hash-link scrolling on client
// navigation. A native client has no such thing to piggyback on, so this
// is really just "workId + sectionId + paragraphId" spelled as a web URL —
// worth revisiting into a structured locator if a non-web client ever
// needs to open a passage without a URL to hand off to.
function openAtPassageHref(
  anchor: { workId: string; sectionId: string },
  paragraphId: string,
) {
  return `/read/${anchor.workId}?section=${anchor.sectionId}#${paragraphId}` as const;
}

/**
 * commonplace.$entryId.tsx's page loader and
 * api.v1.commonplace.$entryId.tsx's JSON loader share this — one Entry,
 * same access boundary as fetchCommonplaceShelf (anchorParagraph -> section
 * -> chapter -> work). Throws the same 404 whether the id doesn't exist at
 * all or belongs to someone else, matching assertWorkReadableBy's
 * convention.
 */
export async function fetchCommonplaceEntry(
  db: Pick<PrismaClient, "entry">,
  userId: string,
  entryId: string,
) {
  const entryRow = await db.entry.findFirst({
    where: {
      id: entryId,
      anchorParagraph: {
        section: { chapter: { work: workAccessWhere(userId) } },
      },
    },
    include: anchorInclude,
  });
  if (!entryRow) throw new Response("Not found", { status: 404 });

  const excerpt =
    entryRow.contextSnapshot && typeof entryRow.contextSnapshot === "object"
      ? (entryRow.contextSnapshot as { excerpt?: string }).excerpt
      : undefined;

  const anchor = describeAnchor(entryRow.anchorParagraph);

  return {
    entry: {
      id: entryRow.id,
      origin: entryRow.origin,
      body: entryRow.body,
      excerpt,
      date: formatEntryDateTime(entryRow.createdAt),
      locator: formatShelfLocator(anchor),
      openAtPassageHref: openAtPassageHref(anchor, entryRow.anchorParagraph.id),
    },
  };
}
