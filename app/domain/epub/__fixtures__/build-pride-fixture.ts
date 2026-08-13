import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";

/**
 * Builds the second ingest fixture: pride-and-prejudice.epub — needed by
 * #22 so `/commonplace` has entries from more than one work to prove
 * provenance counts and locators aren't accidentally single-work.
 *
 * This is HAND-AUTHORED, same as capital-volume-i.epub, and for a
 * different reason: Pride and Prejudice genuinely is on Standard Ebooks
 * (confirmed at https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice
 * while building this), but its "download" link doesn't serve the epub
 * directly — it's a "Your download has started" interstitial page that
 * hands the file off via the browser, not a plain fetchable URL, so a
 * direct download in a sandbox returns that HTML page, not a zip. Rather
 * than pretend a curl of that URL is the real book, this fixture is
 * modeled on the same Standard-Ebooks XHTML/OPF conventions as the
 * capital-volume-i.epub fixture (which documents where those conventions
 * were checked), with the real `karl-marx/capital-volume-i` identifier
 * swapped for `jane-austen/pride-and-prejudice` — the actual identifier
 * that title uses there, once the book itself is genuinely reachable to
 * ingest for real.
 *
 * Text is genuine, out-of-copyright Austen (1813): Chapter 1's opening two
 * paragraphs are the most famous lines in the book — quoted here from
 * memory with high confidence given how frequently they're cited — and
 * the Bennets' dialogue that follows is included for structural realism
 * (a chapter with several paragraphs, not just the opening lines), not
 * exercised by any assertion.
 *
 * Run with: npx tsx app/domain/epub/__fixtures__/build-pride-fixture.ts
 */

const containerXml = `<?xml version="1.0" encoding="utf-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="epub/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0" xml:lang="en-GB">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice</dc:identifier>
    <dc:title>Pride and Prejudice</dc:title>
    <dc:creator>Jane Austen</dc:creator>
    <dc:language>en-GB</dc:language>
  </metadata>
  <manifest>
    <item id="titlepage.xhtml" href="text/titlepage.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-1.xhtml" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="titlepage.xhtml"/>
    <itemref idref="chapter-1.xhtml"/>
  </spine>
</package>
`;

// No <section epub:type="chapter"> here — same "skip non-chapter spine
// items" path the capital fixture's titlepage exercises.
const titlepageXhtml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en-GB">
<head><title>Titlepage</title></head>
<body epub:type="frontmatter titlepage">
  <section epub:type="titlepage">
    <h1>Pride and Prejudice</h1>
    <p>Jane Austen</p>
  </section>
</body>
</html>
`;

// One chapter, no nested <section> — the parser's "implicit single
// section" path (chapter-1's own body of <p>s), not exercised by the
// capital fixture, which nests <section epub:type="division"> throughout.
const chapter1Xhtml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en-GB">
<head><title>Chapter 1</title></head>
<body epub:type="bodymatter">
<section epub:type="chapter" id="chapter-1">
<h2>Chapter 1</h2>
<p>It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.</p>
<p>However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered as the rightful property of some one or other of their daughters.</p>
<p>“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”</p>
<p>Mr. Bennet replied that he had not.</p>
<p>“But it is,” returned she; “for Mrs. Long has just been here, and she told me all about it.”</p>
<p>Mr. Bennet made no answer.</p>
<p>“Do not you want to know who has taken it?” cried his wife impatiently.</p>
<p>“You want to tell me, and I have no objection to hearing it.”</p>
</section>
</body>
</html>
`;

export function buildPrideFixtureEpub(): Uint8Array {
  return zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(containerXml),
    "epub/content.opf": strToU8(contentOpf),
    "epub/text/titlepage.xhtml": strToU8(titlepageXhtml),
    "epub/text/chapter-1.xhtml": strToU8(chapter1Xhtml),
  });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const outPath = fileURLToPath(
    new URL("./pride-and-prejudice.epub", import.meta.url),
  );
  writeFileSync(outPath, buildPrideFixtureEpub());
  console.log(`Wrote ${outPath}`);
}
