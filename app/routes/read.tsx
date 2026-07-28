import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { db } from "~/db.server";
import { requireUser } from "~/user.server";
import { ChapterSectionDivider } from "~/components/ChapterSectionDivider";
import { PageStack } from "~/components/PageStack";
import { ReadingParagraph } from "~/components/ReadingParagraph";
import { SelectionHighlighter } from "~/components/SelectionHighlighter";
import { useBookmarkTracker } from "~/components/useBookmarkTracker";
import { useVirtualizedRows } from "~/components/useVirtualizedRows";
import { formatLocator, formatLocatorRange } from "~/domain/locator";
import { highlightClassName } from "~/domain/paragraph/highlightRole";
import { overlapsExisting } from "~/domain/paragraph/highlightOverlap";
import { countWords } from "~/domain/reading/readingTime";
import { computeReadingProgress } from "~/domain/reading/readingProgress";
import {
  nextSectionRef,
  previousSectionRef,
  resolveSectionRef,
  type SectionRef,
} from "~/domain/reading/sectionNavigation";
import { SectionNav } from "~/components/SectionNav";
import type { Route } from "./+types/read";

// Rough guesses used only until useVirtualizedRows' ResizeObserver reports
// each row's real height — just enough that the very first paint windows
// correctly around the initial scroll position instead of mounting the
// whole book. A paragraph's average is ~2-3 lines at 17.5px/1.8 leading in
// the 660px reading column, plus its own mb-5; a divider is one line plus
// its mb-6.
const ESTIMATED_PARAGRAPH_HEIGHT_PX = 110;
const ESTIMATED_DIVIDER_HEIGHT_PX = 64;

// The six postures from the design's lens rail (1c) and chip row (2a/2c).
// Purely decorative here — no selection state, no tool calls. Real posture
// invocation is M3's.
const POSTURES = ["Interrogate", "Steelman", "Connect", "Close-read", "Context", "Recap"];

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `${loaderData.work.title} — Reading Rig` : "Reading Rig" }];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const user = await requireUser();
  const workId = params["*"];
  const sectionIdParam = new URL(request.url).searchParams.get("section");

  // Chapter/section outline only here — cheap, no paragraph text. Used to
  // resolve ?section= below and, client-side, to compute SectionNav's
  // prev/next targets as the reader jumps around (see the component).
  const work = await db.work.findFirstOrThrow({
    where: { id: workId, userId: user.id },
    include: {
      chapters: {
        orderBy: { ordinal: "asc" },
        include: { sections: { orderBy: { ordinal: "asc" }, select: { id: true, label: true, ordinal: true } } },
      },
    },
  });

  // ?section=<id> only picks where the reader *lands* on this load — the
  // whole work still renders as one continuous column below (#51). Absent
  // (or pointing at a section that isn't actually part of this work) falls
  // back to the first chapter's first section.
  const initialSection = resolveSectionRef(work.chapters, sectionIdParam);

  // The whole work's paragraphs, not one section's: the reading pane is a
  // single continuous scroll now, so every chapter/section has to be in
  // the loader's data even though only a window of it is ever mounted as
  // real DOM (useVirtualizedRows, client-side). Ordered by globalOrdinal —
  // already the whole-work reading order, so no per-section re-sort is
  // needed to lay paragraphs out end to end.
  //
  // highlightSpans/entries are fetched as their own queries, joined back
  // to the same workId path, rather than a nested Prisma `include` off
  // paragraph — a nested include resolves as a second query filtered by
  // `paragraphId IN (<every paragraph's id>)`, and at ~2000 paragraphs
  // (a full novel) that blows past SQLite's bound-parameter limit outright
  // (P2029). Filtering by the join path instead of an id list sidesteps
  // the limit regardless of how many paragraphs the work has.
  const [paragraphRows, highlightSpans, entries] = await Promise.all([
    db.paragraph.findMany({
      where: { section: { chapter: { workId: work.id } } },
      orderBy: { globalOrdinal: "asc" },
      include: { section: { select: { id: true, ordinal: true, chapter: { select: { id: true, ordinal: true } } } } },
    }),
    db.highlightSpan.findMany({
      where: { paragraph: { section: { chapter: { workId: work.id } } } },
      include: { highlight: true },
    }),
    db.entry.findMany({
      where: { anchorParagraph: { section: { chapter: { workId: work.id } } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const highlightSpansByParagraphId = new Map<string, typeof highlightSpans>();
  for (const span of highlightSpans) {
    const list = highlightSpansByParagraphId.get(span.paragraphId) ?? [];
    list.push(span);
    highlightSpansByParagraphId.set(span.paragraphId, list);
  }
  const entriesByParagraphId = new Map<string, typeof entries>();
  for (const entry of entries) {
    const list = entriesByParagraphId.get(entry.anchorParagraphId) ?? [];
    list.push(entry);
    entriesByParagraphId.set(entry.anchorParagraphId, list);
  }
  const paragraphs = paragraphRows.map((paragraph) => ({
    ...paragraph,
    highlightSpans: highlightSpansByParagraphId.get(paragraph.id) ?? [],
    entries: entriesByParagraphId.get(paragraph.id) ?? [],
  }));

  const position = await db.readingPosition.findUnique({
    where: { userId_workId: { userId: user.id, workId: work.id } },
    include: { paragraph: { select: { globalOrdinal: true } } },
  });
  // No position yet means nothing has been read: globalOrdinal 0 is
  // "before the first paragraph", which both isWithinBookmark and the
  // progress/time-left math below treat correctly as the starting line.
  const bookmarkGlobalOrdinal = position?.paragraph.globalOrdinal ?? 0;

  // totalParagraphs/remainingWords used to be their own queries against
  // paragraphs this loader otherwise never touched (one section's worth
  // wasn't the whole work). Now that every paragraph is already loaded
  // above, deriving both from that same array in memory is strictly
  // cheaper than two more round trips — the *values* mean exactly what
  // they always did (progressPercent is still bookmarkGlobalOrdinal over
  // the whole work's paragraph count), only where they're computed changed.
  //
  // computeReadingProgress (app/domain/reading/readingProgress.ts) is the
  // one place that math lives — the client re-runs the exact same function
  // after each scroll-settle debounce (#54, phase 3 of #51), against the
  // paragraphs this same loader already put in memory, rather than a
  // second implementation that could drift from this one.
  const totalParagraphs = paragraphs.length;
  const { progressPercent, timeLeft } = computeReadingProgress(
    paragraphs.map((p) => ({ globalOrdinal: p.globalOrdinal, wordCount: countWords(p.text) })),
    totalParagraphs,
    bookmarkGlobalOrdinal,
  );

  return {
    work,
    paragraphs,
    initialSection,
    bookmarkGlobalOrdinal,
    progressPercent,
    timeLeft,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser();
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "highlight") {
    const spans = JSON.parse(String(formData.get("spans"))) as Array<{
      paragraphId: string;
      start: number;
      end: number;
    }>;

    // Same ownership boundary the loader enforces: a paragraph only exists
    // for this action if it resolves back to the requesting user's own work.
    // Checked for every paragraph a spanning highlight touches, not just one.
    const paragraphIds = spans.map((s) => s.paragraphId);
    const ownedParagraphs = await db.paragraph.findMany({
      where: { id: { in: paragraphIds }, section: { chapter: { work: { userId: user.id } } } },
    });
    if (ownedParagraphs.length !== paragraphIds.length) throw new Response("Not found", { status: 404 });

    // mergeHighlights.ts refuses to render two highlights over the same
    // character rather than silently attributing it to whichever comes
    // first — reject the overlap here, before it's ever persisted, instead
    // of only discovering it later, mid-render, for every reader of the
    // paragraph.
    const existingSpans = await db.highlightSpan.findMany({
      where: { paragraphId: { in: paragraphIds } },
      select: { paragraphId: true, startOffset: true, endOffset: true },
    });
    const overlaps = overlapsExisting(
      spans,
      existingSpans.map((s) => ({ paragraphId: s.paragraphId, start: s.startOffset, end: s.endOffset })),
    );
    if (overlaps) throw new Response("This selection overlaps an existing highlight", { status: 409 });

    // Every highlight made through this UI is role: hand — there's no Rig
    // yet to make the other kind (that's M3's). One Highlight, one
    // HighlightSpan per paragraph it reaches.
    await db.highlight.create({
      data: {
        role: "hand",
        spans: {
          create: spans.map((s) => ({ paragraphId: s.paragraphId, startOffset: s.start, endOffset: s.end })),
        },
      },
    });
    return { ok: true };
  }

  if (intent === "highlight-note") {
    // A note about a *fresh* spanning selection — there's no Highlight
    // yet for it to reference (unlike the "note" branch below, which
    // attaches to one that already exists), so this creates both
    // together in one transaction: cancelling the note composer before
    // this ever fires leaves nothing behind, and there's no window where
    // the Highlight exists without the note that was actually the point.
    const spans = JSON.parse(String(formData.get("spans"))) as Array<{
      paragraphId: string;
      start: number;
      end: number;
    }>;

    const paragraphIds = spans.map((s) => s.paragraphId);
    const ownedParagraphs = await db.paragraph.findMany({
      where: { id: { in: paragraphIds }, section: { chapter: { work: { userId: user.id } } } },
    });
    if (ownedParagraphs.length !== paragraphIds.length) throw new Response("Not found", { status: 404 });

    const body = String(formData.get("body") ?? "").trim();
    if (!body) throw new Response("A note needs a body", { status: 400 });

    await db.$transaction(async (tx) => {
      const highlight = await tx.highlight.create({
        data: {
          role: "hand",
          spans: {
            create: spans.map((s) => ({ paragraphId: s.paragraphId, startOffset: s.start, endOffset: s.end })),
          },
        },
      });
      await tx.entry.create({
        data: {
          origin: "hand",
          body,
          // The first paragraph the selection reaches — same "coarser
          // than Highlight, on purpose" anchor every Entry uses (see the
          // model comment in schema.prisma). `spans` arrives in document
          // order from resolveSelectionSpans, so spans[0] is it.
          anchorParagraphId: spans[0].paragraphId,
          highlightId: highlight.id,
          contextSnapshot: { excerpt: String(formData.get("excerpt") ?? "") },
        },
      });
    });
    return { ok: true };
  }

  if (intent === "note") {
    const paragraphId = String(formData.get("paragraphId"));
    const ownedParagraph = await db.paragraph.findFirst({
      where: { id: paragraphId, section: { chapter: { work: { userId: user.id } } } },
    });
    if (!ownedParagraph) throw new Response("Not found", { status: 404 });

    // A note can be about a Highlight instead of standing alone. Ownership
    // rides on the paragraph check above: the highlight has to actually
    // reach the paragraph this note anchors to, so there's no separate
    // work/userId lookup to duplicate here.
    const highlightIdRaw = formData.get("highlightId");
    let highlightId: string | null = null;
    if (highlightIdRaw) {
      const span = await db.highlightSpan.findFirst({
        where: { highlightId: String(highlightIdRaw), paragraphId },
      });
      if (!span) throw new Response("Not found", { status: 404 });
      highlightId = String(highlightIdRaw);
    }

    const body = String(formData.get("body") ?? "").trim();
    if (!body) throw new Response("A note needs a body", { status: 400 });
    // contextSnapshot's only field today is the excerpt this was saved
    // against — a hand entry's whole "provenance" until M3 gives the Rig
    // richer context (which passages and prior entries were in view) to
    // capture in the same field.
    await db.entry.create({
      data: {
        origin: "hand",
        body,
        anchorParagraphId: paragraphId,
        highlightId,
        contextSnapshot: { excerpt: String(formData.get("excerpt") ?? "") },
      },
    });
    return { ok: true };
  }

  if (intent === "bookmark") {
    const paragraphId = String(formData.get("paragraphId"));

    // Same ownership boundary the loader enforces: a paragraph only exists
    // for this action if it resolves back to the requesting user's own work.
    const paragraph = await db.paragraph.findFirst({
      where: { id: paragraphId, section: { chapter: { work: { userId: user.id } } } },
      select: { section: { select: { chapter: { select: { workId: true } } } } },
    });
    if (!paragraph) throw new Response("Not found", { status: 404 });

    const workId = paragraph.section.chapter.workId;
    await db.readingPosition.upsert({
      where: { userId_workId: { userId: user.id, workId } },
      update: { paragraphId },
      create: { userId: user.id, workId, paragraphId },
    });
    return { ok: true };
  }

  throw new Response("Unknown intent", { status: 400 });
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// A note about a Highlight, not a bare paragraph selection — the escape
// hatch from Entry's usual single-paragraph reach (see the highlightId
// comment in schema.prisma). Its own small form rather than reusing
// SelectionHighlighter's composer: there's no live text selection or
// bounding rect here, just a highlight already sitting in the sidebar.
function HighlightNoteComposer({
  highlightId,
  anchorParagraphId,
  excerpt,
}: {
  highlightId: string;
  anchorParagraphId: string;
  excerpt: string;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const fetcher = useFetcher<typeof action>();

  // fetcher.data persists across the fetcher's whole lifetime, not just the
  // submission that produced it — only react to a *fresh* success by
  // watching fetcher.state's transition back to idle, not fetcher.data's
  // mere presence (which would also fire on reopening after an earlier save).
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setOpen(false);
      setBody("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state]);

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost mt-2 text-[11px]" onClick={() => setOpen(true)}>
        Write a note
      </button>
    );
  }

  return (
    <fetcher.Form
      method="post"
      className="mt-2 flex flex-col gap-2"
      onSubmit={(e) => {
        if (body.trim().length === 0) e.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value="note" />
      <input type="hidden" name="paragraphId" value={anchorParagraphId} />
      <input type="hidden" name="highlightId" value={highlightId} />
      <input type="hidden" name="excerpt" value={excerpt} />
      <textarea
        autoFocus
        className="input"
        rows={2}
        placeholder="Write in the margin…"
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary">
          Save
        </button>
      </div>
    </fetcher.Form>
  );
}

// One row per thing that actually occupies vertical space in the
// continuous reading column — a paragraph, or a chapter/section divider
// immediately before that section's first paragraph. useVirtualizedRows
// mounts/unmounts by row, not by paragraph alone, so a divider has to be
// a row in its own right or its height would never be accounted for in
// the spacer math.
type LoaderParagraph = Route.ComponentProps["loaderData"]["paragraphs"][number];
type ReadingRow =
  | { type: "divider"; id: string; chapterOrdinal: number; sectionOrdinal: number }
  | { type: "paragraph"; id: string; paragraph: LoaderParagraph };

export default function Read({ loaderData }: Route.ComponentProps) {
  const {
    work,
    paragraphs,
    initialSection,
    bookmarkGlobalOrdinal,
    progressPercent: initialProgressPercent,
    timeLeft: initialTimeLeft,
  } = loaderData;

  // A paragraph's own ordinal-within-its-section is 1 exactly for the
  // first paragraph of a section — cheaper than re-deriving section
  // boundaries from work.chapters, and it's already loaded per paragraph.
  const rows = useMemo<ReadingRow[]>(() => {
    const result: ReadingRow[] = [];
    for (const paragraph of paragraphs) {
      if (paragraph.ordinal === 1) {
        result.push({
          type: "divider",
          id: `divider:${paragraph.section.id}`,
          chapterOrdinal: paragraph.section.chapter.ordinal,
          sectionOrdinal: paragraph.section.ordinal,
        });
      }
      result.push({ type: "paragraph", id: paragraph.id, paragraph });
    }
    return result;
  }, [paragraphs]);

  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const initialHeights = useMemo(
    () => rows.map((row) => (row.type === "divider" ? ESTIMATED_DIVIDER_HEIGHT_PX : ESTIMATED_PARAGRAPH_HEIGHT_PX)),
    [rows],
  );

  const readingColumnRef = useRef<HTMLDivElement>(null);
  const { startIndex, endIndex, topSpacerHeight, bottomSpacerHeight, registerRowRef, scrollToRow } =
    useVirtualizedRows({ containerRef: readingColumnRef, rowIds, initialHeights });

  // SectionNav's own notion of "where am I" — it moves both when
  // SectionNav is clicked (jumpToSection, below) and, now, whenever the
  // scroll-settle debounce below resolves to a different section (#54);
  // either way the URL is kept in sync with whichever one moved it last.
  const [currentSectionRef, setCurrentSectionRef] = useState<SectionRef | null>(initialSection);
  const previousSection = currentSectionRef ? previousSectionRef(work.chapters, currentSectionRef) : null;
  const nextSection = currentSectionRef ? nextSectionRef(work.chapters, currentSectionRef) : null;

  // Per paragraph: everything useBookmarkTracker needs to resolve "current
  // section" and recompute progress/timeLeft client-side, without a
  // second fetch — the whole work's paragraphs (text included) are
  // already loaded via loaderData (phase 1, #53); only the word count and
  // section reference need deriving from that once here.
  const paragraphInfoById = useMemo(
    () =>
      Object.fromEntries(
        paragraphs.map((p) => [
          p.id,
          {
            globalOrdinal: p.globalOrdinal,
            wordCount: countWords(p.text),
            section: { chapterId: p.section.chapter.id, sectionId: p.section.id },
          },
        ]),
      ),
    [paragraphs],
  );

  const { progressPercent, timeLeft } = useBookmarkTracker({
    containerRef: readingColumnRef,
    workId: work.id,
    paragraphs: paragraphInfoById,
    totalParagraphs: paragraphs.length,
    initialGlobalOrdinal: bookmarkGlobalOrdinal,
    initialProgressPercent,
    initialTimeLeft,
    onSectionChange: setCurrentSectionRef,
  });

  function jumpToSection(target: SectionRef) {
    scrollToRow(`divider:${target.sectionId}`);
    setCurrentSectionRef(target);
    // A plain history update, not a react-router navigation: the whole
    // work's paragraphs are already loaded client-side, so re-running the
    // loader over a ?section= change would only refetch data this page
    // already has, for no benefit beyond a URL that matches — pointless
    // network round trip and a scroll-position reset to boot.
    window.history.replaceState(null, "", `/read/${work.id}?section=${target.sectionId}`);
  }

  // Deep-linking to a specific section (?section=<id>) still has to move
  // the reader there once, since the column otherwise always mounts at
  // the top of the whole work. Runs once — scrollToRow's own estimate-vs-
  // measured accuracy caveat applies most here, jumping potentially dozens
  // of chapters on nothing but ESTIMATED_PARAGRAPH_HEIGHT_PX guesses.
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (didInitialScroll.current) return;
    didInitialScroll.current = true;
    const firstSection = work.chapters[0]?.sections[0];
    if (initialSection && initialSection.sectionId !== firstSection?.id) {
      scrollToRow(`divider:${initialSection.sectionId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entries = paragraphs.flatMap((paragraph) =>
    paragraph.entries.map((entry) => ({
      id: entry.id,
      body: entry.body,
      highlightId: entry.highlightId,
      locator: formatLocator({
        sectionLabel: String(paragraph.section.ordinal),
        paragraphOrdinal: paragraph.ordinal,
      }),
      excerpt:
        entry.contextSnapshot && typeof entry.contextSnapshot === "object"
          ? (entry.contextSnapshot as { excerpt?: string }).excerpt
          : undefined,
    })),
  );

  // One list item per Highlight, not per HighlightSpan: a spanning
  // highlight touches several paragraphs but is one thing the user made.
  // `paragraphs` is already ordinal-ordered (the loader's own orderBy), so
  // appending each span's text as we walk paragraphs in order reconstructs
  // the highlight's full text without a separate sort here. A highlight
  // can now reach across a section (even a chapter) boundary — each part
  // carries its own section ordinal rather than assuming one shared
  // section for the whole highlight.
  const highlightGroups = new Map<
    string,
    { paragraphId: string; sectionOrdinal: number; paragraphOrdinal: number; text: string }[]
  >();
  for (const paragraph of paragraphs) {
    for (const span of paragraph.highlightSpans) {
      const parts = highlightGroups.get(span.highlightId) ?? [];
      parts.push({
        paragraphId: paragraph.id,
        sectionOrdinal: paragraph.section.ordinal,
        paragraphOrdinal: paragraph.ordinal,
        text: paragraph.text.slice(span.startOffset, span.endOffset),
      });
      highlightGroups.set(span.highlightId, parts);
    }
  }

  const highlights = Array.from(highlightGroups.entries()).map(([id, parts]) => {
    const first = parts[0];
    const last = parts[parts.length - 1];
    // formatLocatorRange already collapses to a single `formatLocator` when
    // both ends land in the same section and paragraph — no need for this
    // call site to also branch on that itself.
    const locator = formatLocatorRange(
      { sectionLabel: String(first.sectionOrdinal), paragraphOrdinal: first.paragraphOrdinal },
      { sectionLabel: String(last.sectionOrdinal), paragraphOrdinal: last.paragraphOrdinal },
    );
    // A note about this highlight anchors to its first paragraph — the
    // same "coarser than Highlight, on purpose" rule Entry always
    // follows (see the model comment in schema.prisma).
    return { id, locator, text: parts.map((p) => p.text).join(" "), anchorParagraphId: first.paragraphId };
  });

  return (
    <div className="flex h-screen flex-col bg-surface">
      <header className="flex flex-none items-center gap-4 px-6 py-4">
        <span className="font-heading text-lg">Reading Rig</span>
        <span className="text-[13px] opacity-60">{work.title}</span>
        <span className="ml-auto text-[11px] uppercase tracking-wide opacity-45">
          {progressPercent}% · {timeLeft}
        </span>
        <SectionNav
          onPrevious={previousSection ? () => jumpToSection(previousSection) : null}
          onNext={nextSection ? () => jumpToSection(nextSection) : null}
        />
        <div className="seg">
          <Link
            to={`/read/${work.id}`}
            className="seg-opt"
            style={{ background: "var(--color-accent)", color: "var(--color-bg)" }}
          >
            Reading
          </Link>
          <Link to="/commonplace" className="seg-opt border-l border-divider">
            Commonplace
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <PageStack progress={progressPercent / 100} side="read" className="flex-none" />

        <SelectionHighlighter>
          <div
            ref={readingColumnRef}
            className="min-w-0 flex-1 overflow-y-auto bg-bg px-16 pt-12"
          >
            <div className="mx-auto max-w-[660px]">
              {/* Spacers stand in for every unmounted row's combined height so
                  scroll height (and the scrollbar's own proportions) stay
                  correct without the whole book existing as real DOM nodes. */}
              <div style={{ height: topSpacerHeight }} />
              {rows.slice(startIndex, endIndex).map((row) =>
                row.type === "divider" ? (
                  <ChapterSectionDivider
                    key={row.id}
                    ref={registerRowRef(row.id)}
                    chapterOrdinal={row.chapterOrdinal}
                    sectionOrdinal={row.sectionOrdinal}
                  />
                ) : (
                  <ReadingParagraph
                    key={row.id}
                    ref={registerRowRef(row.id)}
                    paragraph={row.paragraph}
                    highlights={row.paragraph.highlightSpans.map((s) => ({
                      start: s.startOffset,
                      end: s.endOffset,
                      className: highlightClassName(s.highlight.role),
                    }))}
                  />
                ),
              )}
              <div style={{ height: bottomSpacerHeight }} />
              {paragraphs.length === 0 && (
                <p className="text-sm opacity-50">This work has no ingested text yet.</p>
              )}
            </div>
          </div>
        </SelectionHighlighter>

        <PageStack progress={progressPercent / 100} side="toGo" className="flex-none" />

        <div className="flex w-16 flex-none flex-col items-center gap-6 py-8">
          {POSTURES.map((posture, i) => (
            <span
              key={posture}
              className="text-[11.5px] tracking-wide [writing-mode:vertical-rl]"
              style={i === 0 ? { color: "var(--color-bg)", background: "var(--color-accent)", borderRadius: 999, padding: "14px 7px" } : { opacity: 0.6 }}
            >
              {posture}
            </span>
          ))}
        </div>

        <div className="flex w-[428px] flex-none flex-col px-8 pt-8">
          <span className="font-heading text-base">Today's page</span>
          {entries.length === 0 && highlights.length === 0 ? (
            <p className="mt-4 text-sm opacity-50">Nothing kept here yet.</p>
          ) : (
            <>
              {highlights.length > 0 && (
                <ul className="mt-4 flex flex-col gap-4">
                  {highlights.map((h) => (
                    <li key={h.id} className="rounded-[22px] bg-bg p-4">
                      <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--color-accent-2-700)]">
                        {h.locator}
                      </div>
                      <div className="font-reading text-[13.5px] leading-[1.65]">{h.text}</div>
                      <HighlightNoteComposer highlightId={h.id} anchorParagraphId={h.anchorParagraphId} excerpt={h.text} />
                    </li>
                  ))}
                </ul>
              )}
              {entries.length > 0 && (
                <ul className="mt-4 flex flex-col gap-4">
                  {entries.map((entry) => (
                    <li key={entry.id} className="rounded-[22px] bg-bg p-4">
                      <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--color-accent-2-700)]">
                        Your hand · {entry.locator}
                        {entry.highlightId && " · on your highlight"}
                        {entry.excerpt && ` · saved while reading "${truncate(entry.excerpt, 48)}"`}
                      </div>
                      <div className="font-reading text-[13.5px] leading-[1.65]">{entry.body}</div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
