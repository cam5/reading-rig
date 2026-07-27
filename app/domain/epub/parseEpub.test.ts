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
  });

  it("skips spine items with no <section epub:type=\"chapter\"> — titlepage.xhtml", () => {
    const work = loadFixture();
    // Only chapter-1.xhtml has a chapter section; titlepage.xhtml doesn't,
    // so it must not become a phantom chapter.
    expect(work.chapters).toHaveLength(1);
    expect(work.chapters[0].label).toBe("Chapter 1: The Commodity");
  });

  it("splits a chapter's nested <section epub:type=\"division\"> into Sections", () => {
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
    const all = work.chapters.flatMap((c) => c.sections.flatMap((s) => s.paragraphs));
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

    const originalParagraphId = original.chapters[0].sections[0].paragraphs[0].id;
    const revisedParagraphId = revised.chapters[0].sections[0].paragraphs[0].id;
    expect(revisedParagraphId).not.toBe(originalParagraphId);
  });
});

describe("deriveWorkId", () => {
  it("extracts the author/title slug from a Standard-Ebooks-shaped URL identifier", () => {
    expect(
      deriveWorkId("https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice"),
    ).toBe("jane-austen/pride-and-prejudice");
  });

  it("falls back to slugifying a non-URL identifier, e.g. a bare urn:isbn", () => {
    expect(deriveWorkId("urn:isbn:9780000000000")).toBe("isbn-9780000000000");
  });
});
