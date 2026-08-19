import type { PrismaClient } from "../../../generated/prisma/client";
import {
  track,
  trackContext,
  type AnalyticsClient,
  type AnalyticsEvent,
} from "~/analytics.server";
import { formatLocator, formatLocatorRange } from "~/domain/locator";
import { assertParagraphsAnnotatableBy } from "~/domain/paragraph/assertParagraphsAnnotatableBy.server";
import { computeProgressPercent } from "./readingProgress";

type Db = Pick<
  PrismaClient,
  | "highlight"
  | "entry"
  | "highlightSpan"
  | "paragraph"
  | "readingPosition"
  | "$transaction"
>;

type ActionUser = { id: string };

type SpanRange = { paragraphId: string; start: number; end: number };

function parseSpans(formData: FormData): SpanRange[] {
  return JSON.parse(String(formData.get("spans"))) as SpanRange[];
}

// What analytics.server.ts's highlight_created / note_created events carry,
// derived from what each handler below has already resolved. Shared by the
// two handlers that make a highlight (and the two that make a note) so the
// derivation lives in one place rather than twice.
//
// Lengths and locators only — never the highlighted or written text itself
// (#78). Read the event types before adding a property here.
type TrackedSpan = { paragraphId: string; start: number; end: number };
type TrackedParagraph = {
  id: string;
  ordinal: number;
  section: {
    ordinal: number;
    chapter: { ordinal: number; workId: string; work: { title: string } };
  };
};

// assertParagraphsAnnotatableBy already answered "may this user touch these
// paragraphs" — this is a second, unfiltered query for the ordinals/workId
// the event payload needs, not a second access check. `work.title` rides
// along on the same query — screenName's own `readPageTitle` needs it, and
// this is already the one query these handlers make for this paragraph.
function selectTrackedParagraphs(db: Db, paragraphIds: string[]) {
  return db.paragraph.findMany({
    where: { id: { in: paragraphIds } },
    select: {
      id: true,
      ordinal: true,
      section: {
        select: {
          ordinal: true,
          chapter: {
            select: {
              ordinal: true,
              workId: true,
              work: { select: { title: true } },
            },
          },
        },
      },
    },
  });
}

function highlightCreatedEvent(
  spans: TrackedSpan[],
  paragraphs: TrackedParagraph[],
  { withNote }: { withNote: boolean },
): AnalyticsEvent {
  // Every span's paragraph is in `paragraphs` — both call sites resolve it
  // from the same set of ids they just fetched.
  const byId = new Map(
    paragraphs.map((paragraph) => [paragraph.id, paragraph]),
  );
  // `spans` arrives in document order from resolveSelectionSpans, so its
  // two ends are the highlight's two ends.
  const first = byId.get(spans[0].paragraphId)!;
  const last = byId.get(spans[spans.length - 1].paragraphId)!;

  return {
    name: "highlight_created",
    workId: first.section.chapter.workId,
    locator: formatLocatorRange(
      {
        sectionLabel: String(first.section.ordinal),
        paragraphOrdinal: first.ordinal,
      },
      {
        sectionLabel: String(last.section.ordinal),
        paragraphOrdinal: last.ordinal,
      },
    ),
    // Every highlight made through this UI is role: hand — the Rig can't
    // make one until M3.
    role: "hand",
    textLength: spans.reduce(
      (total, span) => total + (span.end - span.start),
      0,
    ),
    paragraphCount: spans.length,
    sectionOrdinal: first.section.ordinal,
    chapterOrdinal: first.section.chapter.ordinal,
    // Section ordinals are only unique within a chapter, so both halves
    // have to match for this to be one section's worth of highlight.
    spansSections:
      first.section.ordinal !== last.section.ordinal ||
      first.section.chapter.ordinal !== last.section.chapter.ordinal,
    withNote,
  };
}

function noteCreatedEvent(
  anchor: TrackedParagraph,
  {
    body,
    excerpt,
    hasHighlightRef,
  }: { body: string; excerpt: string; hasHighlightRef: boolean },
): AnalyticsEvent {
  return {
    name: "note_created",
    workId: anchor.section.chapter.workId,
    locator: formatLocator({
      sectionLabel: String(anchor.section.ordinal),
      paragraphOrdinal: anchor.ordinal,
    }),
    origin: "hand",
    hasHighlightRef,
    hasExcerpt: excerpt.length > 0,
    bodyLength: body.length,
    excerptLength: excerpt.length,
    sectionOrdinal: anchor.section.ordinal,
    chapterOrdinal: anchor.section.chapter.ordinal,
  };
}

async function handleHighlight(
  db: Db,
  user: ActionUser,
  formData: FormData,
  currentUrl: string,
  client: AnalyticsClient,
) {
  const spans = parseSpans(formData);

  // Checked for every paragraph a spanning highlight touches, not just one.
  await assertParagraphsAnnotatableBy(
    db,
    user.id,
    spans.map((s) => s.paragraphId),
  );

  // Every highlight made through this UI is role: hand — there's no Rig
  // yet to make the other kind (that's M3's). One Highlight, one
  // HighlightSpan per paragraph it reaches. Overlap with existing
  // highlights is allowed (#48) — nested marks with compounding opacity
  // are the rendered result, not an error.
  await db.highlight.create({
    data: {
      userId: user.id,
      role: "hand",
      spans: {
        create: spans.map((s) => ({
          paragraphId: s.paragraphId,
          startOffset: s.start,
          endOffset: s.end,
        })),
      },
    },
  });
  const trackedParagraphs = await selectTrackedParagraphs(
    db,
    spans.map((s) => s.paragraphId),
  );
  await track(
    highlightCreatedEvent(spans, trackedParagraphs, { withNote: false }),
    trackContext(
      user.id,
      currentUrl,
      trackedParagraphs[0].section.chapter.work.title,
      client,
    ),
  );
  return { ok: true as const };
}

async function handleHighlightNote(
  db: Db,
  user: ActionUser,
  formData: FormData,
  currentUrl: string,
  client: AnalyticsClient,
) {
  // A note about a *fresh* spanning selection — there's no Highlight yet
  // for it to reference (unlike handleNote below, which attaches to one
  // that already exists), so this creates both together in one
  // transaction: cancelling the note composer before this ever fires
  // leaves nothing behind, and there's no window where the Highlight
  // exists without the note that was actually the point.
  const spans = parseSpans(formData);
  await assertParagraphsAnnotatableBy(
    db,
    user.id,
    spans.map((s) => s.paragraphId),
  );

  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Response("A note needs a body", { status: 400 });
  const excerpt = String(formData.get("excerpt") ?? "");

  await db.$transaction(async (tx) => {
    const highlight = await tx.highlight.create({
      data: {
        userId: user.id,
        role: "hand",
        spans: {
          create: spans.map((s) => ({
            paragraphId: s.paragraphId,
            startOffset: s.start,
            endOffset: s.end,
          })),
        },
      },
    });
    await tx.entry.create({
      data: {
        userId: user.id,
        origin: "hand",
        body,
        // The first paragraph the selection reaches — same "coarser than
        // Highlight, on purpose" anchor every Entry uses (see the model
        // comment in schema.prisma). `spans` arrives in document order
        // from resolveSelectionSpans, so spans[0] is it.
        anchorParagraphId: spans[0].paragraphId,
        highlightId: highlight.id,
        contextSnapshot: { excerpt },
      },
    });
  });

  // Two events, because two things were made — a highlight that happens to
  // carry a note is still a highlight, and counting it only as a note
  // would make hand-highlighting look rarer than it is.
  const trackedParagraphs = await selectTrackedParagraphs(
    db,
    spans.map((s) => s.paragraphId),
  );
  const anchor = trackedParagraphs.find(
    (paragraph) => paragraph.id === spans[0].paragraphId,
  )!;
  const context = trackContext(
    user.id,
    currentUrl,
    anchor.section.chapter.work.title,
    client,
  );
  await track(
    highlightCreatedEvent(spans, trackedParagraphs, { withNote: true }),
    context,
  );
  await track(
    noteCreatedEvent(anchor, { body, excerpt, hasHighlightRef: true }),
    context,
  );
  return { ok: true as const };
}

async function handleNote(
  db: Db,
  user: ActionUser,
  formData: FormData,
  currentUrl: string,
  client: AnalyticsClient,
) {
  const paragraphId = String(formData.get("paragraphId"));
  await assertParagraphsAnnotatableBy(db, user.id, [paragraphId]);

  // A note can be about a Highlight instead of standing alone. Access
  // rides on the paragraph check above: the highlight has to actually
  // reach the paragraph this note anchors to, so there's no separate
  // work/ownerId lookup to duplicate here.
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
  const excerpt = String(formData.get("excerpt") ?? "");
  // contextSnapshot's only field today is the excerpt this was saved
  // against — a hand entry's whole "provenance" until M3 gives the Rig
  // richer context (which passages and prior entries were in view) to
  // capture in the same field.
  await db.entry.create({
    data: {
      userId: user.id,
      origin: "hand",
      body,
      anchorParagraphId: paragraphId,
      highlightId,
      contextSnapshot: { excerpt },
    },
  });
  const [anchor] = await selectTrackedParagraphs(db, [paragraphId]);
  await track(
    noteCreatedEvent(anchor, {
      body,
      excerpt,
      hasHighlightRef: highlightId !== null,
    }),
    trackContext(
      user.id,
      currentUrl,
      anchor.section.chapter.work.title,
      client,
    ),
  );
  return { ok: true as const };
}

async function handleBookmark(
  db: Db,
  user: ActionUser,
  formData: FormData,
  currentUrl: string,
  client: AnalyticsClient,
) {
  const paragraphId = String(formData.get("paragraphId"));
  await assertParagraphsAnnotatableBy(db, user.id, [paragraphId]);

  const paragraph = await db.paragraph.findFirst({
    where: { id: paragraphId },
    select: {
      // globalOrdinal and the two ordinals are bookmark_updated's; the
      // workId was already needed by the upsert below, and work.title
      // rides along the same way selectTrackedParagraphs' does — for
      // screenName, not a second query.
      globalOrdinal: true,
      section: {
        select: {
          ordinal: true,
          chapter: {
            select: {
              ordinal: true,
              workId: true,
              work: { select: { title: true } },
            },
          },
        },
      },
    },
  });
  if (!paragraph) throw new Response("Not found", { status: 404 });

  const workId = paragraph.section.chapter.workId;
  await db.readingPosition.upsert({
    where: { userId_workId: { userId: user.id, workId } },
    update: { paragraphId },
    create: { userId: user.id, workId, paragraphId },
  });

  // The loader gets its denominator from the paragraphs it already loaded;
  // this handler never loads them, so it counts instead — and runs the
  // same computeProgressPercent, so "12%" here and "12%" in the header are
  // the same number by construction, not by coincidence.
  const totalParagraphs = await db.paragraph.count({
    where: { section: { chapter: { workId } } },
  });
  await track(
    {
      name: "bookmark_updated",
      workId,
      globalOrdinal: paragraph.globalOrdinal,
      progressPercent: computeProgressPercent(
        totalParagraphs,
        paragraph.globalOrdinal,
      ),
      totalParagraphs,
      sectionOrdinal: paragraph.section.ordinal,
      chapterOrdinal: paragraph.section.chapter.ordinal,
    },
    trackContext(
      user.id,
      currentUrl,
      paragraph.section.chapter.work.title,
      client,
    ),
  );
  return { ok: true as const };
}

// One handler per intent the reading UI can submit — highlight/write-a-note
// forms, and the bookmark tracker's own fetcher.submit (see
// useBookmarkTracker). Keyed by the same `intent` value the form (or
// SelectionHighlighter/useBookmarkTracker's fetcher.submit) sends.
const actionHandlers = {
  highlight: handleHighlight,
  "highlight-note": handleHighlightNote,
  note: handleNote,
  bookmark: handleBookmark,
} satisfies Record<
  string,
  (
    db: Db,
    user: ActionUser,
    formData: FormData,
    currentUrl: string,
    client: AnalyticsClient,
  ) => Promise<{ ok: true }>
>;

/**
 * read.tsx's page action and api.v1.read.tsx's JSON action share this — the
 * intent-dispatch every highlight/note/bookmark write goes through
 * (`highlight`, `highlight-note`, `note`, `bookmark`; see actionHandlers
 * above). `currentUrl` and `client` are plain values, not the raw
 * `Request`, since that's all `trackContext` needs and it keeps this module
 * independent of any particular request/response framework — both callers
 * derive them from their own `request` via `canonicalRequestUrl` /
 * `analyticsClientFor` (analytics.server.ts) before calling in.
 */
export async function handleReadAction(
  db: Db,
  user: ActionUser,
  formData: FormData,
  currentUrl: string,
  client: AnalyticsClient,
) {
  const intent = String(formData.get("intent"));
  const handler = Object.prototype.hasOwnProperty.call(actionHandlers, intent)
    ? actionHandlers[intent as keyof typeof actionHandlers]
    : undefined;
  if (!handler) throw new Response("Unknown intent", { status: 400 });

  return handler(db, user, formData, currentUrl, client);
}
