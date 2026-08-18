import { Link } from "react-router";
import { db } from "~/db.server";
import { requireUser } from "~/user.server";
import { workAccessWhere } from "~/domain/work/workAccessWhere.server";
import { EntryCard } from "~/components/EntryCard";
import { Kicker } from "~/components/Kicker";
import { SegTab } from "~/components/SegTab";
import {
  bucketEntriesByWhen,
  formatEntryDate,
  provenanceCounts,
  splitAroundExcerpt,
} from "~/domain/commonplace";
import {
  describeAnchor,
  formatShelfLocator,
} from "~/domain/reading/anchorContext";
import { fraunceLinks } from "~/domain/typography/fraunceLinks";
import type { Route } from "./+types/commonplace";
import styles from "./commonplace.module.css";

export function meta() {
  return [{ title: "Commonplace — Reading Rig" }];
}

// EntryCard renders body text in .font-reading — see fraunceLinks.ts for
// why this isn't in root.tsx's global links.
export const links: Route.LinksFunction = () => fraunceLinks;

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const selectedEntryId = url.searchParams.get("entry");

  // The whole shelf, not one work — every Entry that anchors into a
  // paragraph that traces back to a Work this user may access (owned or
  // granted). Same access boundary read.tsx's action enforces on writes,
  // just unfiltered by workId and read-only, since this route has no
  // action.
  const entries = await db.entry.findMany({
    where: {
      anchorParagraph: {
        section: { chapter: { work: workAccessWhere(user.id) } },
      },
    },
    orderBy: { createdAt: "desc" },
    include: {
      anchorParagraph: {
        include: {
          section: {
            include: {
              // `select`, not `include: { work: true }` — the latter
              // returns every scalar column on Work, which since #181
              // means the cover image's raw bytes ride along too (see
              // read.tsx's loader for the full story on why that's
              // expensive). describeAnchor only ever reads id/title.
              chapter: {
                include: { work: { select: { id: true, title: true } } },
              },
            },
          },
        },
      },
    },
  });

  const totalWorks = await db.work.count({ where: workAccessWhere(user.id) });

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
        where: workAccessWhere(user.id),
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
        // so only needs §4 ¶3, this pane spans the whole shelf and the
        // context line has to say which book.
        locator: formatShelfLocator(describeAnchor(entry.anchorParagraph)),
      };
    }),
  };
}

export default function Commonplace({ loaderData }: Route.ComponentProps) {
  const {
    totalEntries,
    totalWorks,
    readingHref,
    when,
    provenance,
    selectedEntryId,
    margin,
    entries,
  } = loaderData;

  return (
    <div className="flex h-screen flex-col bg-surface">
      <header className="flex flex-none flex-wrap items-center gap-4 px-4 py-4 md:px-6">
        <span className={["font-heading", styles.title].join(" ")}>
          Reading Rig
        </span>
        <span className={["ml-auto", styles.entryCount].join(" ")}>
          {totalEntries} {totalEntries === 1 ? "entry" : "entries"} ·{" "}
          {totalWorks} {totalWorks === 1 ? "book" : "books"}
        </span>
        <div className="seg">
          {readingHref ? (
            <SegTab to={readingHref}>Reading</SegTab>
          ) : (
            <span className={["seg-opt", styles.segDisabled].join(" ")}>
              Reading
            </span>
          )}
          <SegTab to="/commonplace" active>
            Commonplace
          </SegTab>
        </div>
      </header>

      {/* Three independently-scrolling columns at md+; below that, a single
          stacked column that scrolls as one page (see each child's own
          overflow/width overrides below). */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <div
          className={[
            "flex flex-none flex-col gap-4 px-4 pt-4 md:gap-7 md:overflow-y-auto md:px-0 md:pt-9 md:pl-8",
            styles.leftRail,
          ].join(" ")}
        >
          <div>
            <Kicker tone="muted" className="mb-3 block">
              When
            </Kicker>
            {when.length === 0 ? (
              <p className={styles.emptyWhen}>Nothing kept yet.</p>
            ) : (
              <div
                className={[
                  "flex gap-4 overflow-x-auto md:flex-col md:gap-2 md:overflow-visible",
                  styles.bucketList,
                ].join(" ")}
              >
                {when.map((bucket) => (
                  <div
                    key={bucket.label}
                    className="flex flex-none items-center gap-2 whitespace-nowrap"
                  >
                    <span
                      className={[
                        "flex-none",
                        styles.dot,
                        bucket.current ? styles.dotCurrent : styles.dotOther,
                      ].join(" ")}
                    />
                    <span
                      className={
                        bucket.current
                          ? styles.bucketLabelCurrent
                          : styles.bucketLabelOther
                      }
                    >
                      {bucket.label}
                    </span>
                    <span
                      className={["md:ml-auto", styles.bucketCount].join(" ")}
                    >
                      {bucket.count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-row flex-wrap gap-1.5 pb-2 md:mt-auto md:flex-col md:items-start md:pb-7">
            <span
              className={["tag tag-accent-2", styles.provenanceTag].join(" ")}
            >
              your hand · {provenance.hand}
            </span>
            <span
              className={["tag tag-accent", styles.provenanceTag].join(" ")}
            >
              kept from the Rig · {provenance.rig}
            </span>
          </div>
        </div>

        <div className="overflow-visible pt-4 md:min-w-0 md:flex-1 md:overflow-y-auto md:pt-9">
          <div
            className={[
              "mx-auto flex flex-col gap-8 px-4 pb-9 md:px-0",
              styles.centerColumn,
            ].join(" ")}
          >
            {entries.length === 0 && (
              <p className={styles.emptyEntries}>
                Nothing kept here yet, from any book on the shelf.
              </p>
            )}
            {entries.map((entry) => (
              <Link
                key={entry.id}
                // Opens the full entry (this ticket's /commonplace/:entryId)
                // rather than just selecting it for the margin rail, the
                // way this Link worked before that route existed — a
                // commonplace book's primary click target is "read this
                // note", not "preview its margin". The margin rail's own
                // ?entry= selection still works (the loader still reads
                // it), just isn't reachable from here anymore; it falls
                // back to the most recent entry, same as before any
                // selection existed.
                to={`/commonplace/${entry.id}`}
                // styles.entryLink is a CSS Module class, unlayered same as
                // organic.css's own `a { color }` rule — it beats that rule
                // on plain specificity, so unlike the Tailwind utility this
                // replaced, no inline style is needed to stop it flattening
                // to plain --color-accent (which, on a hand entry's body
                // text, would read as the semantic violation invariant 1
                // rules out — terracotta means the machine's voice).
                // EntryCard's own kicker keeps its correct colour
                // regardless, since it sets its own text colour class on
                // itself, at the same specificity/layer footing as this one.
                className={[
                  "block",
                  styles.entryLink,
                  entry.id === selectedEntryId ? styles.entryLinkSelected : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <EntryCard
                  origin={entry.origin}
                  locator={entry.locator}
                  excerpt={entry.excerpt}
                  date={entry.date}
                  body={entry.body}
                />
              </Link>
            ))}
          </div>
        </div>

        <div
          className={[
            "hidden flex-none flex-col gap-5 overflow-y-auto pt-9 pr-8 md:flex",
            styles.rightRail,
          ].join(" ")}
        >
          <Kicker tone="muted">The margin it came from</Kicker>
          {margin ? (
            <>
              <div className={["font-reading", styles.marginContext].join(" ")}>
                <span className={styles.contextDim}>
                  {margin.context.before}
                </span>
                <span className={styles.contextMatch}>
                  {margin.context.match}
                </span>
                <span className={styles.contextDim}>
                  {margin.context.after}
                </span>
              </div>
              {/* styles.openPassage is a CSS Module class, unlayered same as
                  organic.css's own `a { color }` rule — no inline style
                  needed to stop that rule from winning and flattening this
                  to plain --color-accent instead of the darker -700 the
                  design (and the kickers elsewhere) use — same fix as the
                  centre column's entry Link above. */}
              <Link
                to={`/read/${margin.workId}?section=${margin.sectionId}`}
                className={styles.openPassage}
              >
                Open at this passage →
              </Link>
              <div className="h-px bg-divider" />
              <p className={styles.nearbyNote}>
                {margin.nearbyCount === 0
                  ? "No other notes sit within a page of it."
                  : margin.nearbyCount === 1
                    ? "1 other note sits within a page of it."
                    : `${margin.nearbyCount} other notes sit within a page of it.`}
              </p>
            </>
          ) : (
            <p className={styles.marginEmpty}>
              Nothing kept yet to show the margin for.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
