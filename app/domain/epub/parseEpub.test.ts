import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { deriveWorkId, parseEpub } from "./parseEpub";

const fixturePath = fileURLToPath(
  new URL("./__fixtures__/capital-volume-i.epub", import.meta.url),
);

function loadFixture() {
  return parseEpub(readFileSync(fixturePath));
}

describe("parseEpub — the fixture (see __fixtures__/build-capital-fixture.ts)", () => {
  it("reads title, author and a stable workId from the OPF", () => {
    const work = loadFixture();
    expect(work.title).toBe("Capital, Volume I");
    expect(work.author).toBe("Karl Marx");
    expect(work.id).toMatch(/^karl-marx\/capital-volume-i@[0-9a-f]{12}$/);
    expect(work.warnings).toEqual([]);
  });

  it('skips spine items with no <section epub:type="chapter"> — titlepage.xhtml', () => {
    const work = loadFixture();
    // Only chapter-1.xhtml has a chapter section; titlepage.xhtml doesn't,
    // so it must not become a phantom chapter.
    expect(work.chapters).toHaveLength(1);
    expect(work.chapters[0].label).toBe("Chapter 1: The Commodity");
  });

  it('splits a chapter\'s nested <section epub:type="division"> into Sections', () => {
    const work = loadFixture();
    const [chapter] = work.chapters;
    expect(chapter.sections).toHaveLength(4);
    expect(chapter.sections.map((s) => s.ordinal)).toEqual([1, 2, 3, 4]);
  });

  it("resolves §4 ¶3 to the exact passage — the ticket's own acceptance line", () => {
    const work = loadFixture();
    const section4 = work.chapters[0].sections.find((s) => s.ordinal === 4)!;
    const paragraph3 = section4.paragraphs.find((p) => p.ordinal === 3)!;
    expect(paragraph3.text).toBe(
      "It is as clear as noon-day, that man, by his industry, changes the " +
        "forms of the materials furnished by Nature, in such a way as to " +
        "make them useful to him. The form of wood, for instance, is " +
        "altered, by making a table out of it. Yet, for all that, the " +
        "table continues to be that common, every-day thing, wood.",
    );
  });

  it("assigns globalOrdinal monotonically across the whole work, not per-section", () => {
    const work = loadFixture();
    const all = work.chapters.flatMap((c) =>
      c.sections.flatMap((s) => s.paragraphs),
    );
    expect(all.map((p) => p.globalOrdinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // And it agrees with reading order: the 7th paragraph overall is §4 ¶3.
    expect(all[6].text.startsWith("It is as clear as noon-day")).toBe(true);
  });

  it("re-ingesting the same bytes produces identical paragraph ids", () => {
    // The property #5 exists for: a re-ingest must not orphan existing
    // highlights and notes, which only holds if paragraph ids are stable
    // across independent parses of the same file.
    const first = loadFixture();
    const second = loadFixture();
    const idsFirst = first.chapters.flatMap((c) =>
      c.sections.flatMap((s) => s.paragraphs.map((p) => p.id)),
    );
    const idsSecond = second.chapters.flatMap((c) =>
      c.sections.flatMap((s) => s.paragraphs.map((p) => p.id)),
    );
    expect(idsSecond).toEqual(idsFirst);
    // And they're not just consistent with each other — they're unique.
    expect(new Set(idsFirst).size).toBe(idsFirst.length);
  });
});

const realWorldFixturePath = fileURLToPath(
  new URL("./__fixtures__/pride-and-prejudice.epub", import.meta.url),
);

/**
 * A genuine, unmodified Standard Ebooks production epub — downloaded from
 * https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice
 * (CC0 1.0 Universal; the source text is US public domain) — rather than
 * a hand-authored or synthetic one. The Capital fixture above is
 * necessarily synthetic (Capital, Vol. I isn't in Standard Ebooks'
 * catalog — see build-capital-fixture.ts), so it can assert exact
 * structure but can't prove the parser survives a real production file's
 * actual shape. This can: Pride and Prejudice's 61 chapters have no
 * nested <section epub:type="division">, exercising the "a chapter with
 * no nested section is itself one implicit section" branch (see
 * findChapterSections's caller in parseEpub.ts) against real content
 * instead of only the comment's say-so.
 */
describe("parseEpub — a real Standard Ebooks production file (Pride and Prejudice)", () => {
  function loadRealWorldFixture() {
    return parseEpub(readFileSync(realWorldFixturePath));
  }

  it("parses all 61 chapters with no structural warnings", () => {
    const work = loadRealWorldFixture();
    expect(work.title).toBe("Pride and Prejudice");
    expect(work.author).toBe("Jane Austen");
    expect(work.warnings).toEqual([]);
    expect(work.chapters).toHaveLength(61);
  });

  it('treats each chapter (no nested <section epub:type="division">) as one implicit section', () => {
    const work = loadRealWorldFixture();
    expect(work.chapters.every((c) => c.sections.length === 1)).toBe(true);
  });

  it("resolves the opening line and keeps globalOrdinal monotonic across the whole novel", () => {
    const work = loadRealWorldFixture();
    const first = work.chapters[0].sections[0].paragraphs[0];
    expect(first.text).toBe(
      "It is a truth universally acknowledged, that a single man in " +
        "possession of a good fortune, must be in want of a wife.",
    );

    const all = work.chapters.flatMap((c) =>
      c.sections.flatMap((s) => s.paragraphs),
    );
    expect(all.map((p) => p.globalOrdinal)).toEqual(all.map((_, i) => i + 1));
  });

  // #139: chapter 7 has Miss Bingley's <blockquote epub:type="z3998:letter">
  // (and Jane's reply, a second letter) as a direct sibling of the
  // chapter's <p> elements — previously invisible to the collector
  // entirely, dropping the whole letter with no trace.
  it("recurses into a <blockquote> letter (chapter 7) instead of dropping it", () => {
    const work = loadRealWorldFixture();
    const chapter7 = work.chapters.find((c) => c.ordinal === 7)!;
    const paragraphs = chapter7.sections[0].paragraphs;

    // 43 plain <p> + two 3-paragraph letters (salutation, body, signature
    // — the signature nested inside the letter's <footer>) = 49.
    expect(paragraphs).toHaveLength(49);

    const salutation = paragraphs.find((p) => p.text.startsWith("“My dear Friend"));
    const signature = paragraphs.find((p) => p.text === "“Caroline Bingley.”");
    expect(salutation?.isBlockquote).toBe(true);
    expect(signature?.isBlockquote).toBe(true);

    expect(paragraphs.filter((p) => p.isBlockquote)).toHaveLength(6);
    // Ordinary prose paragraphs are unaffected.
    expect(paragraphs[0].isBlockquote).toBeFalsy();

    expect(work.warnings).toEqual([]);
  });

  // #139: chapter 47 has a bare <hr/> marking an in-chapter scene break —
  // previously skipped with no trace, letting the paragraphs on either
  // side silently concatenate.
  it("preserves an <hr> scene break (chapter 47) as an explicit marker row", () => {
    const work = loadRealWorldFixture();
    const chapter47 = work.chapters.find((c) => c.ordinal === 47)!;
    const paragraphs = chapter47.sections[0].paragraphs;

    // 72 <p> + 1 scene-break marker = 73.
    expect(paragraphs).toHaveLength(73);

    const sceneBreaks = paragraphs.filter((p) => p.isSceneBreak);
    expect(sceneBreaks).toHaveLength(1);
    expect(sceneBreaks[0].text).toBe("");
    expect(sceneBreaks[0].html).toBe("");
    expect(sceneBreaks[0].wordCount).toBe(0);
    // It sits where the source <hr/> did: after the 18th <p>, before the 19th.
    expect(sceneBreaks[0].ordinal).toBe(19);

    expect(work.warnings).toEqual([]);
  });
});

const monteCristoFixturePath = fileURLToPath(
  new URL("./__fixtures__/the-count-of-monte-cristo.epub", import.meta.url),
);

/**
 * A second genuine, unmodified Standard Ebooks production epub —
 * The Count of Monte Cristo by Alexandre Dumas, the 1846 Chapman and Hall
 * translation. Produced for Standard Ebooks by volunteer Vince Rice, based
 * on a Project Gutenberg transcription; released under CC0 1.0 Universal
 * (public domain dedication) — see this edition's own colophon at
 * https://standardebooks.org/ebooks/alexandre-dumas/the-count-of-monte-cristo/chapman-and-hall
 * and standardebooks.org for the volunteer-driven project behind it.
 *
 * Chosen for #138/#139 fixture coverage the Pride and Prejudice fixture
 * doesn't have: 33 <a epub:type="noteref"> markers joined against a real,
 * separate-spine-file <section epub:type="endnotes"> (endnotes.xhtml) —
 * see the footnote-specific describe block below — plus its own
 * independent blockquote/hr/table real-world cases.
 */
describe("parseEpub — a second real Standard Ebooks production file (The Count of Monte Cristo)", () => {
  function loadMonteCristoFixture() {
    return parseEpub(readFileSync(monteCristoFixturePath));
  }

  it("parses all 117 chapters", () => {
    const work = loadMonteCristoFixture();
    expect(work.title).toBe("The Count of Monte Cristo");
    expect(work.author).toBe("Alexandre Dumas");
    expect(work.chapters).toHaveLength(117);
  });

  it("recurses into a <blockquote> quoted document (chapter 14) instead of dropping it", () => {
    const work = loadMonteCristoFixture();
    const chapter14 = work.chapters.find((c) =>
      c.sections[0].paragraphs.some((p) => p.text.includes("Caligula or Nero")),
    )!;
    const paragraphs = chapter14.sections[0].paragraphs;

    expect(paragraphs).toHaveLength(128);
    expect(paragraphs.filter((p) => p.isBlockquote)).toHaveLength(3);
    const record = paragraphs.find((p) => p.text.startsWith("Violent Bonapartist"));
    expect(record?.isBlockquote).toBe(true);
  });

  it("preserves an <hr> scene break (chapter 117) as an explicit marker row", () => {
    const work = loadMonteCristoFixture();
    const chapter117 = work.chapters.find((c) =>
      c.sections[0].paragraphs.some((p) => p.text.includes("the count has deceived me")),
    )!;
    const paragraphs = chapter117.sections[0].paragraphs;

    expect(paragraphs).toHaveLength(150);
    const sceneBreaks = paragraphs.filter((p) => p.isSceneBreak);
    expect(sceneBreaks).toHaveLength(1);
    expect(sceneBreaks[0].text).toBe("");
  });

  it("warns (rather than silently dropping) a <table> — still out of scope for #139", () => {
    const work = loadMonteCristoFixture();
    const tableWarning = work.warnings.find((w) => w.includes("chapter-106.xhtml"));
    expect(tableWarning).toBeDefined();
    expect(tableWarning).toContain("<table>");
  });
});

// A minimal, self-contained EPUB — not the Capital fixture — so this test
// owns both "editions" directly instead of reaching into the fixture
// builder's fixed content.
function buildMinimalEpub(paragraphText: string): Uint8Array {
  const containerXml = `<?xml version="1.0" encoding="utf-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="epub/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0" xml:lang="en-GB">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">https://standardebooks.org/ebooks/karl-marx/capital-volume-i</dc:identifier>
    <dc:title>Capital, Volume I</dc:title>
    <dc:creator>Karl Marx</dc:creator>
  </metadata>
  <manifest>
    <item id="chapter-1.xhtml" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter-1.xhtml"/>
  </spine>
</package>`;

  const chapter1Xhtml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body epub:type="bodymatter">
<section epub:type="chapter" id="chapter-1">
<h2>Chapter 1</h2>
<p>${paragraphText}</p>
</section>
</body>
</html>`;

  return zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(containerXml),
    "epub/content.opf": strToU8(contentOpf),
    "epub/text/chapter-1.xhtml": strToU8(chapter1Xhtml),
  });
}

describe("edition forking — same OPF identifier, different bytes", () => {
  it("gives identical bytes the identical workId and paragraph id", () => {
    const a = parseEpub(buildMinimalEpub("Same text."));
    const b = parseEpub(buildMinimalEpub("Same text."));
    expect(b.id).toBe(a.id);
    expect(b.chapters[0].sections[0].paragraphs[0].id).toBe(
      a.chapters[0].sections[0].paragraphs[0].id,
    );
  });

  it("gives a revised edition (same identifier, changed text) a different workId and paragraph id", () => {
    // This is the case a purely structural (position-only) id would get
    // wrong: same book, same slot, different content — and it must NOT
    // collide, or persistWork's upsert would silently overwrite the
    // original edition's paragraph that a highlight already points at.
    const original = parseEpub(buildMinimalEpub("The original text."));
    const revised = parseEpub(buildMinimalEpub("An errata-corrected text."));

    expect(revised.id).not.toBe(original.id);
    // Same underlying book, though — the slug half of the id still agrees.
    expect(revised.id.split("@")[0]).toBe(original.id.split("@")[0]);

    const originalParagraphId =
      original.chapters[0].sections[0].paragraphs[0].id;
    const revisedParagraphId = revised.chapters[0].sections[0].paragraphs[0].id;
    expect(revisedParagraphId).not.toBe(originalParagraphId);
  });
});

// A chapter file with two top-level <section epub:type="chapter"> elements
// — the structurally ambiguous case findChapterSections must report rather
// than silently resolve by keeping only the first.
function buildTwoChapterSectionsEpub(): Uint8Array {
  const containerXml = `<?xml version="1.0" encoding="utf-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="epub/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0" xml:lang="en-GB">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">https://standardebooks.org/ebooks/test-author/test-book</dc:identifier>
    <dc:title>Test Book</dc:title>
    <dc:creator>Test Author</dc:creator>
  </metadata>
  <manifest>
    <item id="chapter-1.xhtml" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter-1.xhtml"/>
  </spine>
</package>`;

  const chapter1Xhtml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body epub:type="bodymatter">
<section epub:type="chapter" id="chapter-1">
<h2>Chapter 1</h2>
<p>First chapter section's text.</p>
</section>
<section epub:type="chapter" id="chapter-1-again">
<h2>Chapter 1, again</h2>
<p>Second chapter section's text — dropped, but must not be silent.</p>
</section>
</body>
</html>`;

  return zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(containerXml),
    "epub/content.opf": strToU8(contentOpf),
    "epub/text/chapter-1.xhtml": strToU8(chapter1Xhtml),
  });
}

describe("ingest warnings — structurally ambiguous cases", () => {
  it("warns, and keeps only the first, when a file has more than one top-level chapter section", () => {
    const work = parseEpub(buildTwoChapterSectionsEpub());

    expect(work.warnings).toHaveLength(1);
    expect(work.warnings[0]).toContain("chapter-1.xhtml");
    expect(work.warnings[0]).toContain("2 top-level");

    // The existing "keep the first" behavior is unchanged — only now it's
    // visible instead of a silent drop.
    expect(work.chapters).toHaveLength(1);
    expect(work.chapters[0].sections[0].paragraphs[0].text).toBe(
      "First chapter section's text.",
    );
  });
});

describe("deriveWorkId", () => {
  it("extracts the author/title slug from a Standard-Ebooks-shaped URL identifier", () => {
    expect(
      deriveWorkId(
        "https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice",
      ),
    ).toBe("jane-austen/pride-and-prejudice");
  });

  it("falls back to slugifying a non-URL identifier, e.g. a bare urn:isbn", () => {
    expect(deriveWorkId("urn:isbn:9780000000000")).toBe("isbn-9780000000000");
  });
});
