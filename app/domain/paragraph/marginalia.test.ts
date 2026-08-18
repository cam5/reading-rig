import { describe, expect, it } from "vitest";
import {
  deriveEntries,
  deriveHighlights,
  pendingEntryToDisplay,
  pendingHighlightToDisplay,
} from "./marginalia";

describe("deriveEntries", () => {
  it("includes everything when marginaliaOrdinalRange is null", () => {
    const result = deriveEntries(
      [
        {
          ordinal: 2,
          globalOrdinal: 20,
          section: { ordinal: 4 },
          entries: [
            {
              id: "e1",
              body: "A thought.",
              highlightId: null,
              contextSnapshot: null,
            },
          ],
        },
      ],
      null,
    );
    expect(result).toEqual([
      {
        id: "e1",
        body: "A thought.",
        highlightId: null,
        locator: "§4 ¶2",
        excerpt: undefined,
      },
    ]);
  });

  it("excludes entries on paragraphs outside the marginalia range", () => {
    const result = deriveEntries(
      [
        {
          ordinal: 1,
          globalOrdinal: 1,
          section: { ordinal: 1 },
          entries: [
            {
              id: "e1",
              body: "outside",
              highlightId: null,
              contextSnapshot: null,
            },
          ],
        },
        {
          ordinal: 2,
          globalOrdinal: 20,
          section: { ordinal: 4 },
          entries: [
            {
              id: "e2",
              body: "inside",
              highlightId: null,
              contextSnapshot: null,
            },
          ],
        },
      ],
      { minGlobalOrdinal: 10, maxGlobalOrdinal: 30 },
    );
    expect(result.map((e) => e.id)).toEqual(["e2"]);
  });

  it("pulls the excerpt out of a well-formed contextSnapshot", () => {
    const result = deriveEntries(
      [
        {
          ordinal: 1,
          globalOrdinal: 1,
          section: { ordinal: 1 },
          entries: [
            {
              id: "e1",
              body: "x",
              highlightId: null,
              contextSnapshot: { excerpt: "quoted bit" },
            },
          ],
        },
      ],
      null,
    );
    expect(result[0].excerpt).toBe("quoted bit");
  });

  it("leaves excerpt undefined for a malformed or missing contextSnapshot", () => {
    const result = deriveEntries(
      [
        {
          ordinal: 1,
          globalOrdinal: 1,
          section: { ordinal: 1 },
          entries: [
            { id: "e1", body: "x", highlightId: null, contextSnapshot: null },
          ],
        },
        {
          ordinal: 2,
          globalOrdinal: 2,
          section: { ordinal: 1 },
          entries: [
            {
              id: "e2",
              body: "y",
              highlightId: null,
              contextSnapshot: "not an object",
            },
          ],
        },
      ],
      null,
    );
    expect(result.map((e) => e.excerpt)).toEqual([undefined, undefined]);
  });
});

describe("deriveHighlights", () => {
  it("is empty when there are no highlight spans", () => {
    expect(
      deriveHighlights(
        [
          {
            id: "p1",
            ordinal: 1,
            globalOrdinal: 1,
            text: "hello",
            section: { ordinal: 1 },
            highlightSpans: [],
          },
        ],
        null,
      ),
    ).toEqual([]);
  });

  it("groups spans by highlight, not by paragraph", () => {
    const result = deriveHighlights(
      [
        {
          id: "p1",
          ordinal: 1,
          globalOrdinal: 1,
          text: "hello world",
          section: { ordinal: 3 },
          highlightSpans: [{ highlightId: "h1", startOffset: 0, endOffset: 5 }],
        },
      ],
      null,
    );
    expect(result).toEqual([
      { id: "h1", locator: "§3 ¶1", text: "hello", anchorParagraphId: "p1" },
    ]);
  });

  it("joins a spanning highlight's text across paragraphs, in ordinal order, with a range locator", () => {
    const result = deriveHighlights(
      [
        {
          id: "p1",
          ordinal: 1,
          globalOrdinal: 1,
          text: "one two",
          section: { ordinal: 3 },
          highlightSpans: [{ highlightId: "h1", startOffset: 0, endOffset: 3 }],
        },
        {
          id: "p2",
          ordinal: 2,
          globalOrdinal: 2,
          text: "three four",
          section: { ordinal: 3 },
          highlightSpans: [{ highlightId: "h1", startOffset: 0, endOffset: 5 }],
        },
      ],
      null,
    );
    expect(result).toEqual([
      {
        id: "h1",
        locator: "§3 ¶1–2",
        text: "one three",
        anchorParagraphId: "p1",
      },
    ]);
  });

  it("formats a locator range across a section boundary when a highlight straddles one", () => {
    const result = deriveHighlights(
      [
        {
          id: "p1",
          ordinal: 5,
          globalOrdinal: 10,
          text: "end of section three",
          section: { ordinal: 3 },
          highlightSpans: [{ highlightId: "h1", startOffset: 0, endOffset: 3 }],
        },
        {
          id: "p2",
          ordinal: 1,
          globalOrdinal: 11,
          text: "start of section four",
          section: { ordinal: 4 },
          highlightSpans: [{ highlightId: "h1", startOffset: 0, endOffset: 5 }],
        },
      ],
      null,
    );
    expect(result[0].locator).toBe("§3 ¶5 – §4 ¶1");
  });

  it("anchors a spanning highlight to its first paragraph, not its last", () => {
    const result = deriveHighlights(
      [
        {
          id: "p1",
          ordinal: 1,
          globalOrdinal: 1,
          text: "one",
          section: { ordinal: 1 },
          highlightSpans: [{ highlightId: "h1", startOffset: 0, endOffset: 3 }],
        },
        {
          id: "p2",
          ordinal: 2,
          globalOrdinal: 2,
          text: "two",
          section: { ordinal: 1 },
          highlightSpans: [{ highlightId: "h1", startOffset: 0, endOffset: 3 }],
        },
      ],
      null,
    );
    expect(result[0].anchorParagraphId).toBe("p1");
  });

  it("keeps distinct highlights on the same paragraph as separate entries", () => {
    const result = deriveHighlights(
      [
        {
          id: "p1",
          ordinal: 1,
          globalOrdinal: 1,
          text: "one two three",
          section: { ordinal: 1 },
          highlightSpans: [
            { highlightId: "h1", startOffset: 0, endOffset: 3 },
            { highlightId: "h2", startOffset: 4, endOffset: 7 },
          ],
        },
      ],
      null,
    );
    expect(result.map((h) => h.id).sort()).toEqual(["h1", "h2"]);
  });

  it("excludes a highlight none of whose parts anchor inside the marginalia range", () => {
    const result = deriveHighlights(
      [
        {
          id: "p1",
          ordinal: 1,
          globalOrdinal: 1,
          text: "outside",
          section: { ordinal: 1 },
          highlightSpans: [{ highlightId: "h1", startOffset: 0, endOffset: 3 }],
        },
      ],
      { minGlobalOrdinal: 10, maxGlobalOrdinal: 30 },
    );
    expect(result).toEqual([]);
  });

  it("includes a highlight if any one of its parts anchors inside the marginalia range", () => {
    const result = deriveHighlights(
      [
        {
          id: "p1",
          ordinal: 1,
          globalOrdinal: 5,
          text: "outside",
          section: { ordinal: 1 },
          highlightSpans: [{ highlightId: "h1", startOffset: 0, endOffset: 3 }],
        },
        {
          id: "p2",
          ordinal: 2,
          globalOrdinal: 20,
          text: "inside",
          section: { ordinal: 1 },
          highlightSpans: [{ highlightId: "h1", startOffset: 0, endOffset: 3 }],
        },
      ],
      { minGlobalOrdinal: 10, maxGlobalOrdinal: 30 },
    );
    // Included (and whole, not truncated) because part of it reaches marginalia.
    expect(result).toEqual([
      {
        id: "h1",
        locator: "§1 ¶1–2",
        text: "out ins",
        anchorParagraphId: "p1",
      },
    ]);
  });
});

describe("pendingHighlightToDisplay", () => {
  const locatorFor = (id: string) =>
    ({ p1: { ordinal: 1, section: { ordinal: 3 } } })[id];

  it("slices the pending spans' text out of the given paragraph text", () => {
    const result = pendingHighlightToDisplay(
      { tempId: "tmp1", spans: [{ paragraphId: "p1", start: 0, end: 5 }] },
      { p1: "hello world" },
      locatorFor,
    );
    expect(result).toEqual({
      id: "tmp1",
      locator: "§3 ¶1",
      text: "hello",
      anchorParagraphId: "p1",
      pending: true,
    });
  });

  it("joins a spanning pending highlight's text across paragraphs, with a range locator", () => {
    const locator = (id: string) =>
      (
        ({
          p1: { ordinal: 1, section: { ordinal: 3 } },
          p2: { ordinal: 2, section: { ordinal: 3 } },
        }) as Record<string, { ordinal: number; section: { ordinal: number } }>
      )[id];
    const result = pendingHighlightToDisplay(
      {
        tempId: "tmp1",
        spans: [
          { paragraphId: "p1", start: 0, end: 3 },
          { paragraphId: "p2", start: 0, end: 5 },
        ],
      },
      { p1: "one two", p2: "three four" },
      locator,
    );
    expect(result.locator).toBe("§3 ¶1–2");
    expect(result.text).toBe("one three");
  });

  it("falls back to an empty locator when a span's paragraph has no known position yet", () => {
    const result = pendingHighlightToDisplay(
      { tempId: "tmp1", spans: [{ paragraphId: "unknown", start: 0, end: 3 }] },
      { unknown: "abc" },
      () => undefined,
    );
    expect(result.locator).toBe("");
  });
});

describe("pendingEntryToDisplay", () => {
  const locatorFor = (id: string) =>
    ({ p1: { ordinal: 2, section: { ordinal: 4 } } })[id];

  it("carries the pending entry's own body/highlightId/excerpt through", () => {
    const result = pendingEntryToDisplay(
      {
        tempId: "tmp-e1",
        anchorParagraphId: "p1",
        highlightId: "tmp-h1",
        body: "Worth returning to.",
        excerpt: "A specter is haunting Europe.",
      },
      locatorFor,
    );
    expect(result).toEqual({
      id: "tmp-e1",
      body: "Worth returning to.",
      highlightId: "tmp-h1",
      locator: "§4 ¶2",
      excerpt: "A specter is haunting Europe.",
    });
  });

  it("leaves excerpt undefined when the pending entry's own excerpt is empty", () => {
    const result = pendingEntryToDisplay(
      {
        tempId: "tmp-e1",
        anchorParagraphId: "p1",
        highlightId: null,
        body: "x",
        excerpt: "",
      },
      locatorFor,
    );
    expect(result.excerpt).toBeUndefined();
  });
});
