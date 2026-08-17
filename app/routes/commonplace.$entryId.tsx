import { Link } from "react-router";
import { db } from "~/db.server";
import { requireUser } from "~/user.server";
import { EntryCard } from "~/components/EntryCard";
import { formatEntryDate } from "~/domain/commonplace";
import {
  describeAnchor,
  formatShelfLocator,
} from "~/domain/reading/anchorContext";
import { fraunceLinks } from "~/domain/typography/fraunceLinks";
import type { Route } from "./+types/commonplace.$entryId";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: loaderData
        ? `${loaderData.entry.locator} — Reading Rig`
        : "Reading Rig",
    },
  ];
}

// EntryCard renders body text in .font-reading — see fraunceLinks.ts for
// why this isn't in root.tsx's global links.
export const links: Route.LinksFunction = () => fraunceLinks;

/** The main entry's context line wants a time as well as a date (3b: "12
 * Mar, 22:41") — finer-grained than 3a's list, which only ever needs to
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
// the job of landing on the exact paragraph, not just its section —
// react-router's <ScrollRestoration> emulates hash-link scrolling on
// client navigation.
function openAtPassageHref(
  anchor: {
    workId: string;
    sectionId: string;
  },
  paragraphId: string,
) {
  return `/read/${anchor.workId}?section=${anchor.sectionId}#${paragraphId}` as const;
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const user = await requireUser();
  const entryId = params.entryId;

  // Same ownership boundary read.tsx's action and commonplace.tsx's list
  // both enforce: an entry only exists for this route if it resolves back
  // to the requesting user's own work through anchorParagraph -> section
  // -> chapter -> work.
  const entryRow = await db.entry.findFirst({
    where: {
      id: entryId,
      anchorParagraph: { section: { chapter: { work: { ownerId: user.id } } } },
    },
    include: {
      anchorParagraph: {
        include: {
          section: {
            include: {
              // `select`, not `include: { work: true }` — see read.tsx's
              // loader comment: the latter drags the cover image's raw
              // bytes along too, since #181. describeAnchor only reads
              // id/title.
              chapter: {
                include: { work: { select: { id: true, title: true } } },
              },
            },
          },
        },
      },
    },
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

export default function CommonplaceEntry({ loaderData }: Route.ComponentProps) {
  const { entry } = loaderData;

  return (
    <div className="flex h-screen flex-col bg-surface">
      <header className="flex flex-none items-center gap-4 px-6 py-4">
        <span className="font-heading text-lg">Reading Rig</span>
        <Link
          to="/commonplace"
          className="text-[12.5px]"
          style={{ color: "var(--color-accent-700)" }}
        >
          ← Commonplace
        </Link>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-16">
        <div className="mx-auto max-w-[620px] pt-6">
          <div className="rounded-card bg-bg p-8">
            <EntryCard
              origin={entry.origin}
              locator={entry.locator}
              excerpt={entry.excerpt}
              date={entry.date}
              body={entry.body}
            />

            <div className="mt-6">
              {/* .btn's own `color: var(--color-text)` outranks Organic's
                  unlayered `a { color }` on specificity alone (a class
                  beats an element selector regardless of layer or source
                  order), so this needs no override style the way a plain
                  `text-[...]` Link would — see commonplace.tsx's centre
                  column for that version of the same problem. */}
              <Link
                to={entry.openAtPassageHref}
                className="btn btn-secondary text-[12px]"
              >
                Open at the passage
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
