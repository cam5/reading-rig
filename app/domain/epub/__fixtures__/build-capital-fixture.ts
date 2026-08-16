import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";

/**
 * Builds the ingest test fixture: capital-volume-i.epub.
 *
 * This is HAND-AUTHORED, not a download. Standard Ebooks does not have
 * Capital, Volume I in their catalog — checked directly against their site
 * while building #5; it's on their "wanted" list, not produced. Its XHTML
 * and OPF structure here is modeled on a real cataloged title (Pride and
 * Prejudice's source, inspected via GitHub: the epub:type vocabulary, the
 * <section epub:type="chapter">/<section epub:type="division"> nesting,
 * the package/metadata/manifest/spine shape), so the fixture exercises the
 * same conventions #5 is scoped to parse.
 *
 * The text itself is genuine: the Moore & Aveling translation (1887) of
 * Chapter 1, all four sections, is long out of copyright. Section 4's four
 * paragraphs are copied verbatim from design/Reading Rig.dc.html, which
 * already quotes them across three screens — reusing that exact, already-
 * verified transcription rather than retyping from memory is what lets the
 * ingest test assert §4 ¶3 against it with confidence. Sections 1-3 are
 * shorter, well-known excerpts included for structural realism (multiple
 * sections, multiple paragraphs each) — not exercised by any assertion.
 *
 * Run with: npx tsx app/domain/epub/__fixtures__/build-capital-fixture.ts
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
    <dc:identifier id="uid">karl-marx/capital-volume-i</dc:identifier>
    <dc:title>Capital, Volume I</dc:title>
    <dc:creator>Karl Marx</dc:creator>
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

// No <section epub:type="chapter"> here — this file exercises the parser's
// "skip non-chapter spine items" path (front matter, back matter, nav).
const titlepageXhtml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en-GB">
<head><title>Titlepage</title></head>
<body epub:type="frontmatter titlepage">
  <section epub:type="titlepage">
    <h1>Capital, Volume I</h1>
    <p>Karl Marx</p>
  </section>
</body>
</html>
`;

const chapter1Xhtml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en-GB">
<head><title>Chapter 1: The Commodity</title></head>
<body epub:type="bodymatter">
<section epub:type="chapter" id="chapter-1">
<h2>Chapter 1: The Commodity</h2>

<section epub:type="division" id="chapter-1-1">
<h3>1. The Two Factors of a Commodity: Use-Value and Value</h3>
<p>The wealth of those societies in which the capitalist mode of production prevails, presents itself as &#8220;an immense accumulation of commodities,&#8221; its unit being a single commodity. Our investigation must therefore begin with the analysis of a commodity.</p>
<p>A commodity is, in the first place, an object outside us, a thing that by its properties satisfies human wants of some sort or another. The nature of such wants, whether, for instance, they spring from the stomach or from fancy, makes no difference.</p>
</section>

<section epub:type="division" id="chapter-1-2">
<h3>2. The Two-Fold Character of the Labour Embodied in Commodities</h3>
<p>At first sight a commodity presented itself to us as a complex of two things — use-value and exchange-value. Later on, we shall see that value is the only form in which the social character of commodities can assert itself.</p>
</section>

<section epub:type="division" id="chapter-1-3">
<h3>3. The Form of Value or Exchange-Value</h3>
<p>Commodities come into the world in the shape of use-values, articles, or goods, such as iron, linen, corn, &amp;c. This is their plain, homely, bodily form. They are, however, commodities only because they are something two-fold, both objects of utility, and, at the same time, depositories of value.</p>
</section>

<section epub:type="division" id="chapter-1-4">
<h3>4. The Fetishism of Commodities and the Secret Thereof</h3>
<p>A commodity appears, at first sight, a very trivial thing, and easily understood. Its analysis shows that it is, in reality, a very queer thing, abounding in metaphysical subtleties and theological niceties.</p>
<p>So far as it is a value in use, there is nothing mysterious about it, whether we consider it from the point of view that by its properties it is capable of satisfying human wants, or from the point that those properties are the product of human labour.</p>
<p>It is as clear as noon-day, that man, by his industry, changes the forms of the materials furnished by Nature, in such a way as to make them useful to him. The form of wood, for instance, is altered, by making a table out of it. Yet, for all that, the table continues to be that common, every-day thing, wood.</p>
<p>But, so soon as it steps forth as a commodity, it is changed into something transcendent. It not only stands with its feet on the ground, but, in relation to all other commodities, it stands on its head, and evolves out of its wooden brain grotesque ideas, far more wonderful than table-turning ever was.</p>
</section>

</section>
</body>
</html>
`;

export function buildCapitalFixtureEpub(): Uint8Array {
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
    new URL("./capital-volume-i.epub", import.meta.url),
  );
  writeFileSync(outPath, buildCapitalFixtureEpub());
  console.log(`Wrote ${outPath}`);
}
