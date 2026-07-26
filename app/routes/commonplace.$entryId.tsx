import { Link } from "react-router";
import { db } from "~/db.server";
import { requireUser } from "~/user.server";
import { EntryCard } from "~/components/EntryCard";
import { formatLocator } from "~/domain/locator";
import { POSTURE_LABELS } from "~/domain/postures";
import type { Route } from "./+types/commonplace.$entryId";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `${loaderData.entry.locator} — Reading Rig` : "Reading Rig" }];
}

function formatEntryDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
}

/** The main entry's context line wants a time as well as a date (3b: "12
 * Mar, 22:41") — finer-grained than 3a's list, which only ever needs to
 * distinguish days. */
function formatEntryDateTime(date: Date): string {
  const day = formatEntryDate(date);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(
    date,
  );
  return `${day}, ${time}`;
}

// The one place `Work -> Chapter -> Section -> Paragraph` gets turned into
// both the display locator and the `?section=` jump read.tsx now accepts —
// shared by the opened entry and every thread sibling, since a thread can
// span books.
function describeAnchor(paragraph: {
  id: string;
  ordinal: number;
  section: { id: string; ordinal: number; chapter: { ordinal: number; work: { id: string; title: string } } };
}) {
  const section = paragraph.section;
  const chapter = section.chapter;
  const work = chapter.work;
  return {
    workId: work.id,
    locator: `${work.title} · Ch. ${chapter.ordinal} ${formatLocator({
      sectionLabel: String(section.ordinal),
      paragraphOrdinal: paragraph.ordinal,
    })}`,
    // read.tsx's ?section= lands on the right section; the paragraph's own
    // id is a real DOM id on its <p> (ReadingParagraph), so the fragment
    // finishes the job of landing on the exact paragraph, not just its
    // section — react-router's <ScrollRestoration> emulates hash-link
    // scrolling on client navigation.
    openAtPassageHref: `/read/${work.id}?section=${section.id}#${paragraph.id}` as const,
  };
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const user = await requireUser();
  const entryId = params.entryId;

  // Same ownership boundary read.tsx's action and commonplace.tsx's list
  // both enforce: an entry only exists for this route if it resolves back
  // to the requesting user's own work through anchorParagraph -> section
  // -> chapter -> work.
  const entryRow = await db.entry.findFirst({
    where: { id: entryId, anchorParagraph: { section: { chapter: { work: { ownerId: user.id } } } } },
    include: {
      anchorParagraph: {
        include: { section: { include: { chapter: { include: { work: true } } } } },
      },
    },
  });
  if (!entryRow) throw new Response("Not found", { status: 404 });

  const excerpt =
    entryRow.contextSnapshot && typeof entryRow.contextSnapshot === "object"
      ? (entryRow.contextSnapshot as { excerpt?: string }).excerpt
      : undefined;

  const anchor = describeAnchor(entryRow.anchorParagraph);

  // The thread(s) this entry belongs to — plural, deliberately: nothing in
  // the schema (or read.tsx's own "add to thread" picker) limits an entry
  // to one thread, so this unrolls every thread it's in rather than
  // assuming there's only ever one. Each thread's *other* entries, in
  // ordinal order, are what get unrolled beneath — the entry that opened
  // this page is excluded from its own thread's list.
  const memberships = await db.threadEntry.findMany({
    where: { entryId: entryRow.id },
    select: { thread: { select: { id: true, title: true } } },
  });

  const threads = await Promise.all(
    memberships.map(async ({ thread }) => {
      const siblings = await db.threadEntry.findMany({
        where: { threadId: thread.id, entryId: { not: entryRow.id } },
        orderBy: { ordinal: "asc" },
        include: {
          entry: {
            include: {
              anchorParagraph: { include: { section: { include: { chapter: { include: { work: true } } } } } },
            },
          },
        },
      });
      return {
        id: thread.id,
        title: thread.title,
        entries: siblings.map(({ entry: sibling }) => ({
          id: sibling.id,
          origin: sibling.origin,
          body: sibling.body,
          date: formatEntryDate(sibling.createdAt),
          ...describeAnchor(sibling.anchorParagraph),
        })),
      };
    }),
  );

  return {
    entry: {
      id: entryRow.id,
      origin: entryRow.origin,
      posture: entryRow.posture ? POSTURE_LABELS[entryRow.posture] : undefined,
      body: entryRow.body,
      excerpt,
      date: formatEntryDateTime(entryRow.createdAt),
      locator: anchor.locator,
      openAtPassageHref: anchor.openAtPassageHref,
    },
    threads: threads.filter((t) => t.entries.length > 0),
  };
}

export default function CommonplaceEntry({ loaderData }: Route.ComponentProps) {
  const { entry, threads } = loaderData;

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
          <div className="rounded-[22px] bg-bg p-8">
            <EntryCard
              origin={entry.origin}
              posture={entry.posture}
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
              <Link to={entry.openAtPassageHref} className="btn btn-secondary text-[12px]">
                Open at the passage
              </Link>
            </div>
          </div>

          {threads.map((thread) => (
            <div key={thread.id} className="mt-8">
              <div className="mb-4 text-[10px] tracking-wide uppercase opacity-40">
                Thread · {thread.title}
              </div>
              <div className="flex flex-col gap-4">
                {thread.entries.map((sibling) => (
                  <Link
                    key={sibling.id}
                    to={`/commonplace/${sibling.id}`}
                    className="block py-0.5 pl-3.5 no-underline"
                    style={{
                      color: "var(--color-text)",
                      borderLeft: `2px solid ${
                        sibling.origin === "rig" ? "var(--color-accent)" : "var(--color-accent-2)"
                      }`,
                    }}
                  >
                    <div className="mb-1 text-[11px] opacity-50">
                      {sibling.locator} · {sibling.date}
                    </div>
                    <div className="font-reading text-[15.5px] leading-[1.6]">{sibling.body}</div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
