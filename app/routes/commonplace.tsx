import { Link } from "react-router";
import { db } from "~/db.server";
import { requireUser } from "~/user.server";
import { EntryCard } from "~/components/EntryCard";
import { formatLocator } from "~/domain/locator";
import { bucketEntriesByWhen, provenanceCounts, splitAroundExcerpt } from "~/domain/commonplace";
import { POSTURE_LABELS } from "~/domain/postures";
import type { Route } from "./+types/commonplace";

export function meta() {
  return [{ title: "Commonplace — Reading Rig" }];
}

function formatEntryDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser();
  const url = new URL(request.url);
  const selectedEntryId = url.searchParams.get("entry");

  // The whole shelf, not one work — every Entry that anchors into a
  // paragraph that traces back to a Work this user owns. Same ownership
  // chain read.tsx's action enforces on writes, just unfiltered by workId
  // and read-only, since this route has no action.
  const entries = await db.entry.findMany({
    where: { anchorParagraph: { section: { chapter: { work: { ownerId: user.id } } } } },
    orderBy: { createdAt: "desc" },
    include: {
      anchorParagraph: {
        include: { section: { include: { chapter: { include: { work: true } } } } },
      },
    },
  });

  const totalWorks = await db.work.count({ where: { ownerId: user.id } });

  // The header's "Reading" tab has nowhere obvious to go from here — this
  // page spans the whole shelf, not one work — so it resumes wherever the
  // bookmark last moved, falling back to the shelf's oldest work if
  // nothing's ever been read yet, and disappearing (no link) if the shelf
  // is empty.
  const lastPosition = await db.readingPosition.findFirst({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { workId: true },
  });
  const oldestWork = lastPosition
    ? null
    : await db.work.findFirst({
        where: { ownerId: user.id },
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

  // The right rail shows one entry's margin at a time — whichever the
  // centre column link selected, or the most recent entry by default so
  // the panel is never empty on first load.
  const selected = selectedEntryId ? (entries.find((e) => e.id === selectedEntryId) ?? entries[0]) : entries[0];

  const margin = selected
    ? (() => {
        const excerpt =
          selected.contextSnapshot && typeof selected.contextSnapshot === "object"
            ? (selected.contextSnapshot as { excerpt?: string }).excerpt
            : undefined;
        const context = splitAroundExcerpt(selected.anchorParagraph.text, excerpt);
        // "within a page of it" — a proxy for physical proximity there's
        // no page-image concept to measure against: other entries anchored
        // in the same section.
        const nearbyCount = entries.filter(
          (e) =>
            e.id !== selected.id && e.anchorParagraph.sectionId === selected.anchorParagraph.sectionId,
        ).length;
        return { workId: selected.anchorParagraph.section.chapter.workId, context, nearbyCount };
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
      const paragraph = entry.anchorParagraph;
      const section = paragraph.section;
      const chapter = section.chapter;
      const work = chapter.work;
      const excerpt =
        entry.contextSnapshot && typeof entry.contextSnapshot === "object"
          ? (entry.contextSnapshot as { excerpt?: string }).excerpt
          : undefined;
      return {
        id: entry.id,
        origin: entry.origin,
        posture: entry.posture ? POSTURE_LABELS[entry.posture] : undefined,
        body: entry.body,
        excerpt,
        date: formatEntryDate(entry.createdAt),
        // Work + chapter folded into the locator string itself — unlike
        // read.tsx's "Today's page", which only ever shows one work and
        // so only needs §4 ¶3, this pane spans the whole shelf and the
        // context line has to say which book.
        locator: `${work.title} · Ch. ${chapter.ordinal} ${formatLocator({
          sectionLabel: String(section.ordinal),
          paragraphOrdinal: paragraph.ordinal,
        })}`,
      };
    }),
  };
}

export default function Commonplace({ loaderData }: Route.ComponentProps) {
  const { totalEntries, totalWorks, readingHref, when, provenance, selectedEntryId, margin, entries } =
    loaderData;

  return (
    <div className="flex h-screen flex-col bg-surface">
      <header className="flex flex-none items-center gap-4 px-6 py-4">
        <span className="font-heading text-lg">Reading Rig</span>
        <span className="ml-auto text-[12.5px] opacity-55">
          {totalEntries} {totalEntries === 1 ? "entry" : "entries"} · {totalWorks}{" "}
          {totalWorks === 1 ? "book" : "books"}
        </span>
        <div className="seg">
          {readingHref ? (
            <Link to={readingHref} className="seg-opt">
              Reading
            </Link>
          ) : (
            <span className="seg-opt opacity-40">Reading</span>
          )}
          <Link
            to="/commonplace"
            className="seg-opt border-l border-divider"
            style={{ background: "var(--color-accent)", color: "var(--color-bg)" }}
          >
            Commonplace
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[210px] flex-none flex-col gap-7 overflow-y-auto pt-9 pl-8">
          <div>
            <div className="mb-3 text-[10px] tracking-wide uppercase opacity-40">When</div>
            {when.length === 0 ? (
              <p className="text-[12px] opacity-45">Nothing kept yet.</p>
            ) : (
              <div className="flex flex-col gap-2 text-[13px]">
                {when.map((bucket) => (
                  <div key={bucket.label} className="flex items-center gap-2">
                    <span
                      className="h-[7px] w-[7px] flex-none rounded-full"
                      style={{
                        background: bucket.current ? "var(--color-accent)" : "var(--color-neutral-300)",
                      }}
                    />
                    <span className={bucket.current ? "text-[var(--color-accent-700)]" : "opacity-60"}>
                      {bucket.label}
                    </span>
                    <span className="ml-auto text-[11px] opacity-40">{bucket.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-auto flex flex-col items-start gap-1.5 pb-7">
            <span className="tag tag-accent-2 text-[11px]">your hand · {provenance.hand}</span>
            <span className="tag tag-accent text-[11px]">kept from the Rig · {provenance.rig}</span>
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto pt-9">
          <div className="mx-auto flex max-w-[588px] flex-col gap-8 pb-9">
            {entries.length === 0 && (
              <p className="text-sm opacity-50">Nothing kept here yet, from any book on the shelf.</p>
            )}
            {entries.map((entry) => (
              <Link
                key={entry.id}
                to={`/commonplace?entry=${entry.id}`}
                // Organic's base styles set a global, unlayered `a {
                // color: var(--color-accent) }` — unlayered CSS beats
                // Tailwind's utility classes regardless of specificity
                // (they live in @layer utilities), so a `text-[...]`
                // className here loses to it; only an inline style wins.
                // Without this, wrapping EntryCard in a Link tints its
                // body text (a hand entry's included) terracotta, which
                // is exactly the semantic violation invariant 1 rules out
                // (terracotta means the machine's voice). EntryCard's own
                // kicker keeps its correct colour regardless, since it
                // sets its own text colour class inline on itself, at the
                // same specificity/layer footing as this override.
                className="block rounded-[22px] no-underline"
                style={{
                  color: "var(--color-text)",
                  ...(entry.id === selectedEntryId
                    ? { boxShadow: "0 0 0 1.5px var(--color-accent)" }
                    : null),
                }}
              >
                <EntryCard
                  origin={entry.origin}
                  posture={entry.posture}
                  locator={entry.locator}
                  excerpt={entry.excerpt}
                  date={entry.date}
                  body={entry.body}
                />
              </Link>
            ))}
          </div>
        </div>

        <div className="flex w-[296px] flex-none flex-col gap-5 overflow-y-auto pt-9 pr-8">
          <div className="text-[10px] tracking-wide uppercase opacity-35">The margin it came from</div>
          {margin ? (
            <>
              <div className="font-reading text-[14px] leading-[1.7]">
                <span className="opacity-40">{margin.context.before}</span>
                <span className="opacity-75">{margin.context.match}</span>
                <span className="opacity-40">{margin.context.after}</span>
              </div>
              {/* Inline style, not a text-[...] className, for the same
                  cascade-layer reason as the centre column's Link above:
                  the unlayered `a { color }` rule would otherwise win and
                  flatten this to plain --color-accent instead of the
                  darker -700 the design (and the kickers elsewhere) use. */}
              <Link
                to={`/read/${margin.workId}`}
                className="text-[11.5px]"
                style={{ color: "var(--color-accent-700)" }}
              >
                Open at this passage →
              </Link>
              <div className="h-px bg-divider" />
              <p className="text-[11.5px] leading-[1.7] opacity-45">
                {margin.nearbyCount === 0
                  ? "No other notes sit within a page of it."
                  : margin.nearbyCount === 1
                    ? "1 other note sits within a page of it."
                    : `${margin.nearbyCount} other notes sit within a page of it.`}
              </p>
            </>
          ) : (
            <p className="text-[12px] opacity-45">Nothing kept yet to show the margin for.</p>
          )}
        </div>
      </div>
    </div>
  );
}
