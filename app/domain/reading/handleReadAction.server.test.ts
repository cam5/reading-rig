import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../../generated/prisma/client";
import type { track } from "../../analytics.server";
import { createTestDb } from "../../rig/tools/testDb";
import { handleReadAction } from "./handleReadAction.server";

// A real SQLite database (testDb.ts's per-file copy of the schema-pushed
// template), not a Prisma mock: what these tests care about is which rows
// exist afterwards, and that's only an honest answer against a real one.
//
// `track` is the one thing stubbed — not to keep PostHog quiet (it already
// no-ops without POSTHOG_PROJECT_API_KEY), but so the event each handler
// derives is assertable. `trackContext` and everything else stay real.
const trackMock = vi.hoisted(() => vi.fn<typeof track>(async () => {}));

// handleReadAction.server.ts imports through the `~/` alias, which
// vitest.config.ts doesn't resolve (vite.config.ts's `tsconfigPaths` isn't
// loaded here, by design). Each `~/` specifier it uses is pointed at the
// real module by relative path — these are the real implementations, not
// stand-ins, apart from `track` above.
vi.mock("~/analytics.server", async () => ({
  ...(await vi.importActual<typeof import("../../analytics.server")>(
    "../../analytics.server",
  )),
  track: trackMock,
}));
vi.mock("~/domain/locator", () => vi.importActual("../locator"));
vi.mock("~/domain/paragraph/assertParagraphsAnnotatableBy.server", () =>
  vi.importActual("../paragraph/assertParagraphsAnnotatableBy.server"),
);

const URL = "https://rig.test/read/work-main";

type Fixture = {
  ownerId: string;
  strangerId: string;
  /** Owner's work: ch1 §1 (¶1–3), ch1 §2 (¶1–2), ch2 §1 (¶1) — 6 paragraphs. */
  p: {
    c1s1p1: string;
    c1s1p2: string;
    c1s1p3: string;
    c1s2p1: string;
    c1s2p2: string;
    c2s1p1: string;
  };
  workId: string;
  /** A second work on the owner's shelf — one paragraph. */
  secondWorkId: string;
  secondP1: string;
  /** The stranger's own work — one paragraph the owner has no access to. */
  strangerWorkId: string;
  strangerP1: string;
};

async function seedParagraphs(
  db: PrismaClient,
  {
    workId,
    ownerId,
    title,
    layout,
  }: {
    workId: string;
    ownerId: string;
    title: string;
    /** `layout[chapter][section]` = how many paragraphs that section has. */
    layout: number[][];
  },
): Promise<string[]> {
  await db.work.create({
    data: { id: workId, ownerId, title, author: "Author" },
  });
  const ids: string[] = [];
  let globalOrdinal = 0;
  for (const [c, sections] of layout.entries()) {
    const chapterId = `${workId}::c${c + 1}`;
    await db.chapter.create({
      data: {
        id: chapterId,
        workId,
        label: `Chapter ${c + 1}`,
        ordinal: c + 1,
      },
    });
    for (const [s, paragraphCount] of sections.entries()) {
      const sectionId = `${chapterId}::s${s + 1}`;
      await db.section.create({
        data: {
          id: sectionId,
          chapterId,
          label: String(s + 1),
          ordinal: s + 1,
        },
      });
      for (let i = 1; i <= paragraphCount; i++) {
        globalOrdinal++;
        const id = `${sectionId}::p${i}`;
        const text = `Paragraph ${globalOrdinal} of ${title}.`;
        await db.paragraph.create({
          data: {
            id,
            sectionId,
            html: `<p>${text}</p>`,
            text,
            ordinal: i,
            globalOrdinal,
            wordCount: 4,
          },
        });
        ids.push(id);
      }
    }
  }
  return ids;
}

async function seed(db: PrismaClient): Promise<Fixture> {
  await db.user.create({ data: { id: "owner", email: "owner@test.example" } });
  await db.user.create({
    data: { id: "stranger", email: "stranger@test.example" },
  });

  const [c1s1p1, c1s1p2, c1s1p3, c1s2p1, c1s2p2, c2s1p1] = await seedParagraphs(
    db,
    {
      workId: "work-main",
      ownerId: "owner",
      title: "Middlemarch",
      layout: [[3, 2], [1]],
    },
  );
  const [secondP1] = await seedParagraphs(db, {
    workId: "work-second",
    ownerId: "owner",
    title: "Second",
    layout: [[1]],
  });
  const [strangerP1] = await seedParagraphs(db, {
    workId: "work-stranger",
    ownerId: "stranger",
    title: "Theirs",
    layout: [[1]],
  });

  return {
    ownerId: "owner",
    strangerId: "stranger",
    p: { c1s1p1, c1s1p2, c1s1p3, c1s2p1, c1s2p2, c2s1p1 },
    workId: "work-main",
    secondWorkId: "work-second",
    secondP1,
    strangerWorkId: "work-stranger",
    strangerP1,
  };
}

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

function spans(
  ...ranges: Array<[paragraphId: string, start: number, end: number]>
): string {
  return JSON.stringify(
    ranges.map(([paragraphId, start, end]) => ({ paragraphId, start, end })),
  );
}

describe("handleReadAction", () => {
  let db: PrismaClient;
  let f: Fixture;

  function act(userId: string, fields: Record<string, string>) {
    return handleReadAction(db, { id: userId }, form(fields), URL, "web");
  }

  async function rowCounts() {
    return {
      highlights: await db.highlight.count(),
      spans: await db.highlightSpan.count(),
      entries: await db.entry.count(),
      positions: await db.readingPosition.count(),
    };
  }

  const NOTHING = { highlights: 0, spans: 0, entries: 0, positions: 0 };

  beforeEach(async () => {
    trackMock.mockClear();
    db = createTestDb();
    f = await seed(db);
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  describe("intent dispatch", () => {
    it("throws 400 for an intent it doesn't know", async () => {
      await expect(
        act(f.ownerId, { intent: "delete-everything" }),
      ).rejects.toMatchObject({ status: 400 });
      expect(await rowCounts()).toEqual(NOTHING);
    });

    it("throws 400 when no intent is sent at all", async () => {
      await expect(
        act(f.ownerId, { paragraphId: f.p.c1s1p1 }),
      ).rejects.toMatchObject({ status: 400 });
      expect(await rowCounts()).toEqual(NOTHING);
    });

    // The handler table is a plain object, so an intent has to be one of its
    // *own* keys — these all exist on Object.prototype and must not resolve
    // to a "handler".
    it.each(["toString", "constructor", "hasOwnProperty", "__proto__"])(
      "throws 400 for the inherited property name %s",
      async (intent) => {
        await expect(
          act(f.ownerId, { intent, paragraphId: f.p.c1s1p1 }),
        ).rejects.toMatchObject({ status: 400 });
        expect(trackMock).not.toHaveBeenCalled();
      },
    );

    it("is case-sensitive about intent names", async () => {
      await expect(
        act(f.ownerId, { intent: "Bookmark", paragraphId: f.p.c1s1p1 }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("highlight", () => {
    it("persists one hand Highlight with one span for a single-paragraph selection", async () => {
      const result = await act(f.ownerId, {
        intent: "highlight",
        spans: spans([f.p.c1s1p2, 3, 11]),
      });

      expect(result).toEqual({ ok: true });
      const highlights = await db.highlight.findMany({
        include: { spans: true },
      });
      expect(highlights).toHaveLength(1);
      expect(highlights[0]).toMatchObject({ userId: f.ownerId, role: "hand" });
      expect(highlights[0].spans).toHaveLength(1);
      expect(highlights[0].spans[0]).toMatchObject({
        paragraphId: f.p.c1s1p2,
        startOffset: 3,
        endOffset: 11,
      });
      expect(await db.entry.count()).toBe(0);
    });

    it("persists one Highlight with a span per paragraph for a spanning selection", async () => {
      await act(f.ownerId, {
        intent: "highlight",
        spans: spans([f.p.c1s1p2, 5, 20], [f.p.c1s1p3, 0, 7]),
      });

      const highlights = await db.highlight.findMany({
        include: { spans: { orderBy: { paragraphId: "asc" } } },
      });
      expect(highlights).toHaveLength(1);
      expect(
        highlights[0].spans.map((s) => [
          s.paragraphId,
          s.startOffset,
          s.endOffset,
        ]),
      ).toEqual([
        [f.p.c1s1p2, 5, 20],
        [f.p.c1s1p3, 0, 7],
      ]);
    });

    it("allows an overlapping highlight rather than merging or rejecting it (#48)", async () => {
      const fields = {
        intent: "highlight",
        spans: spans([f.p.c1s1p1, 0, 10]),
      };
      await act(f.ownerId, fields);
      await act(f.ownerId, fields);

      expect(await rowCounts()).toMatchObject({ highlights: 2, spans: 2 });
    });

    it("reports highlight_created with lengths and a locator, in the reader's context", async () => {
      await act(f.ownerId, {
        intent: "highlight",
        spans: spans([f.p.c1s1p2, 5, 20], [f.p.c1s1p3, 0, 7]),
      });

      expect(trackMock).toHaveBeenCalledTimes(1);
      expect(trackMock).toHaveBeenCalledWith(
        {
          name: "highlight_created",
          workId: f.workId,
          locator: "§1 ¶2–3",
          role: "hand",
          textLength: 22,
          paragraphCount: 2,
          sectionOrdinal: 1,
          chapterOrdinal: 1,
          spansSections: false,
          withNote: false,
        },
        {
          distinctId: f.ownerId,
          currentUrl: URL,
          screenName: "Middlemarch — Reading Rig",
          client: "web",
        },
      );
    });

    it("flags a selection that crosses a section boundary", async () => {
      await act(f.ownerId, {
        intent: "highlight",
        spans: spans([f.p.c1s1p3, 2, 9], [f.p.c1s2p1, 0, 4]),
      });

      expect(trackMock.mock.calls[0][0]).toMatchObject({
        locator: "§1 ¶3 – §2 ¶1",
        spansSections: true,
      });
    });

    // Section ordinals restart in each chapter: ch1 §1 → ch2 §1 is two
    // sections even though both are "§1".
    it("flags a selection that crosses a chapter boundary between same-numbered sections", async () => {
      await act(f.ownerId, {
        intent: "highlight",
        spans: spans([f.p.c1s1p1, 0, 4], [f.p.c2s1p1, 0, 4]),
      });

      expect(trackMock.mock.calls[0][0]).toMatchObject({
        spansSections: true,
        chapterOrdinal: 1,
      });
    });

    it("throws 404 and writes nothing for a paragraph in someone else's work", async () => {
      await expect(
        act(f.ownerId, {
          intent: "highlight",
          spans: spans([f.strangerP1, 0, 5]),
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await rowCounts()).toEqual(NOTHING);
      expect(trackMock).not.toHaveBeenCalled();
    });

    it("rejects a spanning selection wholesale if any one paragraph isn't the user's", async () => {
      await expect(
        act(f.ownerId, {
          intent: "highlight",
          spans: spans([f.p.c1s1p1, 0, 5], [f.strangerP1, 0, 5]),
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await rowCounts()).toEqual(NOTHING);
    });

    it("throws 404 for a paragraph id that doesn't exist", async () => {
      await expect(
        act(f.ownerId, {
          intent: "highlight",
          spans: spans(["no-such-paragraph", 0, 5]),
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await rowCounts()).toEqual(NOTHING);
    });

    it("throws 404 rather than writing two spans for the same paragraph", async () => {
      await expect(
        act(f.ownerId, {
          intent: "highlight",
          spans: spans([f.p.c1s1p1, 0, 5], [f.p.c1s1p1, 8, 12]),
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await rowCounts()).toEqual(NOTHING);
    });

    it("lets a user with a WorkGrant highlight, and the Highlight is theirs", async () => {
      await db.workGrant.create({
        data: { userId: f.strangerId, workId: f.workId },
      });

      await act(f.strangerId, {
        intent: "highlight",
        spans: spans([f.p.c1s1p1, 0, 5]),
      });

      const highlights = await db.highlight.findMany();
      expect(highlights).toHaveLength(1);
      expect(highlights[0].userId).toBe(f.strangerId);
    });

    // Shape validation lives one layer up, in api.v1.read.tsx's zod schema
    // (readActionRequestSchema) — these pin what this function does on its
    // own, which is what read.tsx's page action (no schema) gets: an
    // ordinary thrown Error (so a 500), but never a partial write.
    it("throws without writing when spans isn't valid JSON", async () => {
      await expect(
        act(f.ownerId, { intent: "highlight", spans: "not json" }),
      ).rejects.toBeInstanceOf(SyntaxError);
      expect(await rowCounts()).toEqual(NOTHING);
    });

    it("throws without writing when spans is missing", async () => {
      await expect(
        act(f.ownerId, { intent: "highlight" }),
      ).rejects.toBeInstanceOf(Error);
      expect(await rowCounts()).toEqual(NOTHING);
    });

    // FINDING (not fixed here — tests only): an empty `spans` array passes
    // assertParagraphsAnnotatableBy (0 found === 0 asked for), so
    // `highlight.create` runs and persists a Highlight with no spans; the
    // handler then throws a TypeError reading `trackedParagraphs[0]`. The
    // caller sees a 500 and an orphan, invisible Highlight row stays behind.
    // api.v1.read.tsx is guarded by its schema's `.min(1)`; read.tsx's page
    // action is not. Expected: reject up front and leave nothing behind.
    it.fails("writes nothing for an empty spans array", async () => {
      await act(f.ownerId, { intent: "highlight", spans: "[]" }).catch(
        () => {},
      );
      expect(await rowCounts()).toEqual(NOTHING);
    });
  });

  describe("highlight-note", () => {
    it("creates the Highlight and the note about it together", async () => {
      const result = await act(f.ownerId, {
        intent: "highlight-note",
        spans: spans([f.p.c1s1p2, 5, 20], [f.p.c1s1p3, 0, 7]),
        body: "  Why this, here?  ",
        excerpt: "the selected words",
      });

      expect(result).toEqual({ ok: true });
      const highlight = await db.highlight.findFirstOrThrow({
        include: { spans: true },
      });
      expect(highlight).toMatchObject({ userId: f.ownerId, role: "hand" });
      expect(highlight.spans).toHaveLength(2);

      const entries = await db.entry.findMany();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        userId: f.ownerId,
        origin: "hand",
        body: "Why this, here?",
        // Anchored on the first paragraph the selection reaches.
        anchorParagraphId: f.p.c1s1p2,
        highlightId: highlight.id,
        contextSnapshot: { excerpt: "the selected words" },
        rigSessionId: null,
      });
    });

    it("reports both a highlight_created (withNote) and a note_created", async () => {
      await act(f.ownerId, {
        intent: "highlight-note",
        spans: spans([f.p.c1s1p2, 5, 20], [f.p.c1s1p3, 0, 7]),
        body: "Four",
        excerpt: "excerpt!",
      });

      expect(trackMock.mock.calls.map(([event]) => event)).toEqual([
        expect.objectContaining({
          name: "highlight_created",
          withNote: true,
          locator: "§1 ¶2–3",
        }),
        {
          name: "note_created",
          workId: f.workId,
          locator: "§1 ¶2",
          origin: "hand",
          hasHighlightRef: true,
          hasExcerpt: true,
          bodyLength: 4,
          excerptLength: 8,
          sectionOrdinal: 1,
          chapterOrdinal: 1,
        },
      ]);
    });

    // The reason this intent is one transaction rather than a `highlight`
    // followed by a `note`: a rejected note must not strand a Highlight.
    it.each([
      ["empty", ""],
      ["whitespace-only", "  \n\t "],
    ])(
      "throws 400 and leaves no Highlight behind for an %s body",
      async (_, body) => {
        await expect(
          act(f.ownerId, {
            intent: "highlight-note",
            spans: spans([f.p.c1s1p1, 0, 5]),
            body,
          }),
        ).rejects.toMatchObject({ status: 400 });
        expect(await rowCounts()).toEqual(NOTHING);
        expect(trackMock).not.toHaveBeenCalled();
      },
    );

    it("throws 400 when body is missing entirely", async () => {
      await expect(
        act(f.ownerId, {
          intent: "highlight-note",
          spans: spans([f.p.c1s1p1, 0, 5]),
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(await rowCounts()).toEqual(NOTHING);
    });

    it("saves an empty excerpt when none is sent", async () => {
      await act(f.ownerId, {
        intent: "highlight-note",
        spans: spans([f.p.c1s1p1, 0, 5]),
        body: "A thought.",
      });

      const entry = await db.entry.findFirstOrThrow();
      expect(entry.contextSnapshot).toEqual({ excerpt: "" });
      expect(trackMock.mock.calls[1][0]).toMatchObject({
        name: "note_created",
        hasExcerpt: false,
        excerptLength: 0,
      });
    });

    it("throws 404 and writes nothing when the selection reaches someone else's work", async () => {
      await expect(
        act(f.ownerId, {
          intent: "highlight-note",
          spans: spans([f.p.c1s1p1, 0, 5], [f.strangerP1, 0, 5]),
          body: "A thought.",
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await rowCounts()).toEqual(NOTHING);
    });

    // The 404 for access is checked before the 400 for an empty body, so a
    // probe with no body can't tell "not yours" from "doesn't exist".
    it("answers 404, not 400, for an empty body on a paragraph the user can't reach", async () => {
      await expect(
        act(f.ownerId, {
          intent: "highlight-note",
          spans: spans([f.strangerP1, 0, 5]),
          body: "",
        }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("note", () => {
    async function ownerHighlightOn(paragraphId: string, userId = f.ownerId) {
      return db.highlight.create({
        data: {
          userId,
          role: "hand",
          spans: { create: { paragraphId, startOffset: 0, endOffset: 5 } },
        },
      });
    }

    it("persists a free-standing hand note anchored on the paragraph", async () => {
      const result = await act(f.ownerId, {
        intent: "note",
        paragraphId: f.p.c1s2p2,
        body: "\n A margin note. ",
        excerpt: "what was on screen",
      });

      expect(result).toEqual({ ok: true });
      const entries = await db.entry.findMany();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        userId: f.ownerId,
        origin: "hand",
        body: "A margin note.",
        anchorParagraphId: f.p.c1s2p2,
        highlightId: null,
        contextSnapshot: { excerpt: "what was on screen" },
      });
      expect(await db.highlight.count()).toBe(0);
    });

    it("reports note_created with lengths and a locator", async () => {
      await act(f.ownerId, {
        intent: "note",
        paragraphId: f.p.c2s1p1,
        body: "Twelve chars",
      });

      expect(trackMock).toHaveBeenCalledTimes(1);
      expect(trackMock.mock.calls[0][0]).toEqual({
        name: "note_created",
        workId: f.workId,
        locator: "§1 ¶1",
        origin: "hand",
        hasHighlightRef: false,
        hasExcerpt: false,
        bodyLength: 12,
        excerptLength: 0,
        sectionOrdinal: 1,
        chapterOrdinal: 2,
      });
    });

    // #78: the margin is not an analytics payload — lengths and locators
    // only, across every intent that carries the reader's own words.
    it("never puts the note's or the excerpt's text in an event", async () => {
      const body = "PRIVATE-NOTE-BODY";
      const excerpt = "PRIVATE-EXCERPT-TEXT";
      await act(f.ownerId, {
        intent: "note",
        paragraphId: f.p.c1s1p1,
        body,
        excerpt,
      });
      await act(f.ownerId, {
        intent: "highlight-note",
        spans: spans([f.p.c1s1p1, 0, 5]),
        body,
        excerpt,
      });

      const reported = JSON.stringify(trackMock.mock.calls);
      expect(trackMock).toHaveBeenCalledTimes(3);
      expect(reported).not.toContain(body);
      expect(reported).not.toContain(excerpt);
    });

    it("attaches the note to an existing Highlight that reaches the paragraph", async () => {
      const highlight = await ownerHighlightOn(f.p.c1s1p1);

      await act(f.ownerId, {
        intent: "note",
        paragraphId: f.p.c1s1p1,
        highlightId: highlight.id,
        body: "About that highlight.",
      });

      const entry = await db.entry.findFirstOrThrow();
      expect(entry.highlightId).toBe(highlight.id);
      expect(trackMock.mock.calls[0][0]).toMatchObject({
        hasHighlightRef: true,
      });
      // Attaching makes no second Highlight.
      expect(await db.highlight.count()).toBe(1);
    });

    it("throws 404 for a Highlight that doesn't reach the note's paragraph", async () => {
      const highlight = await ownerHighlightOn(f.p.c1s1p1);

      await expect(
        act(f.ownerId, {
          intent: "note",
          paragraphId: f.p.c1s1p2,
          highlightId: highlight.id,
          body: "Wrong paragraph.",
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await db.entry.count()).toBe(0);
    });

    it("throws 404 for a highlightId that doesn't exist", async () => {
      await expect(
        act(f.ownerId, {
          intent: "note",
          paragraphId: f.p.c1s1p1,
          highlightId: "no-such-highlight",
          body: "About nothing.",
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await db.entry.count()).toBe(0);
    });

    it("treats an empty highlightId as a free-standing note", async () => {
      await act(f.ownerId, {
        intent: "note",
        paragraphId: f.p.c1s1p1,
        highlightId: "",
        body: "Standing alone.",
      });

      expect((await db.entry.findFirstOrThrow()).highlightId).toBeNull();
    });

    it.each([
      ["empty", ""],
      ["whitespace-only", "   "],
    ])("throws 400 and writes nothing for an %s body", async (_, body) => {
      await expect(
        act(f.ownerId, { intent: "note", paragraphId: f.p.c1s1p1, body }),
      ).rejects.toMatchObject({ status: 400 });
      expect(await rowCounts()).toEqual(NOTHING);
      expect(trackMock).not.toHaveBeenCalled();
    });

    it("throws 400 when body is missing entirely", async () => {
      await expect(
        act(f.ownerId, { intent: "note", paragraphId: f.p.c1s1p1 }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("throws 404 when paragraphId is missing", async () => {
      await expect(
        act(f.ownerId, { intent: "note", body: "Anchored nowhere." }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await db.entry.count()).toBe(0);
    });

    it("throws 404 and writes nothing for a paragraph in someone else's work", async () => {
      await expect(
        act(f.ownerId, {
          intent: "note",
          paragraphId: f.strangerP1,
          body: "On their book.",
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await db.entry.count()).toBe(0);
    });

    it("lets a user with a WorkGrant write a note, and the note is theirs", async () => {
      await db.workGrant.create({
        data: { userId: f.strangerId, workId: f.workId },
      });

      await act(f.strangerId, {
        intent: "note",
        paragraphId: f.p.c1s1p1,
        body: "A grantee's note.",
      });

      expect((await db.entry.findFirstOrThrow()).userId).toBe(f.strangerId);
    });

    // FINDING (not fixed here — tests only): the highlightId check is "does
    // this Highlight reach this paragraph", with no `userId`. That was the
    // whole access story while a paragraph had exactly one possible
    // annotator (its work's owner); since WorkGrant, two users can share a
    // paragraph, so one can attach their note to the *other's* Highlight if
    // they know its id. Expected: 404, same as any Highlight that isn't
    // theirs.
    it.fails(
      "throws 404 for another user's Highlight on a shared (granted) paragraph",
      async () => {
        await db.workGrant.create({
          data: { userId: f.strangerId, workId: f.workId },
        });
        const ownersHighlight = await ownerHighlightOn(f.p.c1s1p1);

        await expect(
          act(f.strangerId, {
            intent: "note",
            paragraphId: f.p.c1s1p1,
            highlightId: ownersHighlight.id,
            body: "Attached to someone else's highlight.",
          }),
        ).rejects.toMatchObject({ status: 404 });
      },
    );
  });

  describe("bookmark", () => {
    it("creates the user's ReadingPosition for the paragraph's work", async () => {
      const result = await act(f.ownerId, {
        intent: "bookmark",
        paragraphId: f.p.c1s1p2,
      });

      expect(result).toEqual({ ok: true });
      const positions = await db.readingPosition.findMany();
      expect(positions).toHaveLength(1);
      expect(positions[0]).toMatchObject({
        userId: f.ownerId,
        workId: f.workId,
        paragraphId: f.p.c1s1p2,
      });
    });

    it("moves the existing ReadingPosition rather than adding a second", async () => {
      await act(f.ownerId, { intent: "bookmark", paragraphId: f.p.c1s1p2 });
      const before = await db.readingPosition.findFirstOrThrow();

      await act(f.ownerId, { intent: "bookmark", paragraphId: f.p.c2s1p1 });

      const positions = await db.readingPosition.findMany();
      expect(positions).toHaveLength(1);
      expect(positions[0].id).toBe(before.id);
      expect(positions[0].paragraphId).toBe(f.p.c2s1p1);
    });

    it("can move backwards — the bookmark is where the reader is, not a high-water mark", async () => {
      await act(f.ownerId, { intent: "bookmark", paragraphId: f.p.c2s1p1 });
      await act(f.ownerId, { intent: "bookmark", paragraphId: f.p.c1s1p1 });

      const position = await db.readingPosition.findFirstOrThrow();
      expect(position.paragraphId).toBe(f.p.c1s1p1);
    });

    it("is idempotent for the same paragraph", async () => {
      const fields = { intent: "bookmark", paragraphId: f.p.c1s1p3 };
      await act(f.ownerId, fields);
      await act(f.ownerId, fields);

      const positions = await db.readingPosition.findMany();
      expect(positions).toHaveLength(1);
      expect(positions[0].paragraphId).toBe(f.p.c1s1p3);
    });

    it("keeps one position per work on the same shelf", async () => {
      await act(f.ownerId, { intent: "bookmark", paragraphId: f.p.c1s1p2 });
      await act(f.ownerId, { intent: "bookmark", paragraphId: f.secondP1 });

      const positions = await db.readingPosition.findMany({
        orderBy: { workId: "asc" },
      });
      expect(positions.map((p) => [p.workId, p.paragraphId])).toEqual([
        [f.workId, f.p.c1s1p2],
        [f.secondWorkId, f.secondP1],
      ]);
    });

    it("keeps each reader's position in a shared work separate", async () => {
      await db.workGrant.create({
        data: { userId: f.strangerId, workId: f.workId },
      });

      await act(f.ownerId, { intent: "bookmark", paragraphId: f.p.c1s1p1 });
      await act(f.strangerId, { intent: "bookmark", paragraphId: f.p.c2s1p1 });

      const positions = await db.readingPosition.findMany({
        orderBy: { userId: "asc" },
      });
      expect(positions.map((p) => [p.userId, p.paragraphId])).toEqual([
        [f.ownerId, f.p.c1s1p1],
        [f.strangerId, f.p.c2s1p1],
      ]);
    });

    it("reports bookmark_updated with progress through the whole work", async () => {
      // ch1 §2 ¶1 is the 4th of the work's 6 paragraphs.
      await act(f.ownerId, { intent: "bookmark", paragraphId: f.p.c1s2p1 });

      expect(trackMock).toHaveBeenCalledTimes(1);
      expect(trackMock).toHaveBeenCalledWith(
        {
          name: "bookmark_updated",
          workId: f.workId,
          globalOrdinal: 4,
          progressPercent: 67,
          totalParagraphs: 6,
          sectionOrdinal: 2,
          chapterOrdinal: 1,
        },
        {
          distinctId: f.ownerId,
          currentUrl: URL,
          screenName: "Middlemarch — Reading Rig",
          client: "web",
        },
      );
    });

    it("counts only the bookmarked work's paragraphs toward progress", async () => {
      await act(f.ownerId, { intent: "bookmark", paragraphId: f.secondP1 });

      expect(trackMock.mock.calls[0][0]).toMatchObject({
        workId: f.secondWorkId,
        totalParagraphs: 1,
        progressPercent: 100,
      });
    });

    it("throws 404 and writes nothing for a paragraph in someone else's work", async () => {
      await expect(
        act(f.ownerId, { intent: "bookmark", paragraphId: f.strangerP1 }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await rowCounts()).toEqual(NOTHING);
      expect(trackMock).not.toHaveBeenCalled();
    });

    it("throws 404 for a paragraph id that doesn't exist", async () => {
      await expect(
        act(f.ownerId, { intent: "bookmark", paragraphId: "no-such" }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("throws 404 when paragraphId is missing", async () => {
      await expect(
        act(f.ownerId, { intent: "bookmark" }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await rowCounts()).toEqual(NOTHING);
    });

    it("passes the caller's analytics client through", async () => {
      await handleReadAction(
        db,
        { id: f.ownerId },
        form({ intent: "bookmark", paragraphId: f.p.c1s1p1 }),
        URL,
        "mobile-app-ios",
      );

      expect(trackMock.mock.calls[0][1]).toMatchObject({
        client: "mobile-app-ios",
      });
    });
  });
});
