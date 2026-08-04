import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import { unzipSync, strFromU8 } from "fflate";
import { computeParagraphId } from "./paragraphId";
import { sanitizeParagraph } from "./sanitizeHtml";
import { countWords } from "../reading/readingTime";
import type { ParsedChapter, ParsedParagraph, ParsedSection, ParsedWork } from "./types";

/** Elements matching a tag name, ignoring namespace prefixes (`dc:title`,
 * `epub:type` don't survive HTML-mode parsing as real XML namespaces —
 * this sidesteps CSS-selector escaping for the colon entirely). */
function byTag(root: Element | Document, tag: string): Element[] {
  return Array.from(root.querySelectorAll("*")).filter(
    (el) => el.tagName.toLowerCase() === tag,
  );
}

function firstByTag(root: Element | Document, tag: string): Element | null {
  return byTag(root, tag)[0] ?? null;
}

function epubTypeTokens(el: Element): string[] {
  return (el.getAttribute("epub:type") ?? "").split(/\s+/).filter(Boolean);
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i + 1);
}

function resolveHref(baseDir: string, href: string): string {
  // EPUB hrefs are always relative, so a plain join is sufficient here —
  // no ../ segments are expected in a Standard-Ebooks-style layout.
  return (baseDir + href).replace(/^\.\//, "");
}

/**
 * A stable slug from the OPF's dc:identifier, e.g.
 * "https://standardebooks.org/ebooks/karl-marx/capital-volume-i" becomes
 * "karl-marx/capital-volume-i". Falls back to slugifying the identifier
 * whole when it isn't in that ebooks/ URL shape (a urn:isbn:... instead).
 */
export function deriveWorkId(identifier: string): string {
  const marker = "/ebooks/";
  const i = identifier.indexOf(marker);
  const raw = i === -1 ? identifier : identifier.slice(i + marker.length);
  return raw
    .toLowerCase()
    .replace(/^[a-z]+:/, "") // urn:isbn:... -> isbn:...
    .replace(/[^a-z0-9/]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseContainerXml(files: Record<string, Uint8Array>): string {
  const xml = strFromU8(files["META-INF/container.xml"]);
  const { document } = parseHTML(xml);
  const rootfile = firstByTag(document, "rootfile");
  const path = rootfile?.getAttribute("full-path");
  if (!path) throw new Error("container.xml has no <rootfile full-path>");
  return path;
}

type ManifestItem = { href: string; mediaType: string | null };

function parseOpf(opfXml: string) {
  const { document } = parseHTML(opfXml);

  const title = firstByTag(document, "dc:title")?.textContent?.trim() ?? "Untitled";
  const author = firstByTag(document, "dc:creator")?.textContent?.trim() ?? null;
  const identifier = firstByTag(document, "dc:identifier")?.textContent?.trim() ?? title;

  const manifest = new Map<string, ManifestItem>();
  for (const item of byTag(document, "item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) {
      manifest.set(id, { href, mediaType: item.getAttribute("media-type") });
    }
  }

  const spineIds = byTag(document, "itemref")
    .map((el) => el.getAttribute("idref"))
    .filter((id): id is string => Boolean(id));

  return { title, author, identifier, manifest, spineIds };
}

/** Every outer chapter <section> in the file — every one whose epub:type
 * includes "chapter". Files with none (titlepage, imprint, colophon, nav,
 * ...) aren't reading content and are skipped by the caller; files with
 * more than one are a structural surprise the caller must warn about, not
 * silently resolve by picking the first and dropping the rest. */
function findChapterSections(document: Document): Element[] {
  return byTag(document, "section").filter((el) => epubTypeTokens(el).includes("chapter"));
}

function headingText(el: Element): string | null {
  for (const tag of ["h2", "h3", "h4"]) {
    const heading = firstByTag(el, tag);
    if (heading?.textContent?.trim()) return heading.textContent.trim();
  }
  return null;
}

function directChildren(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((c) => c.tagName.toLowerCase() === tag);
}

// Folded into workId below: a revised edition of the same book (same OPF
// identifier, different bytes — an errata pass, a restored paragraph)
// must not resolve to the same id as the edition a highlight was actually
// made against. Without this, persistWork's upsert would silently
// overwrite the old edition's chapters/sections/paragraphs in place —
// not orphaning highlights, but worse, re-anchoring them to different
// text with no signal anything changed. Keyed off the whole file's bytes
// rather than per-paragraph text so the id space simply forks on any
// edition change; parseEpub stays a pure function of bytes and never
// needs to consult the database to decide whether this is a new edition.
function hashEdition(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}

export function parseEpub(bytes: Uint8Array): ParsedWork {
  const files = unzipSync(bytes);
  const opfPath = parseContainerXml(files);
  const opfXml = strFromU8(files[opfPath]);
  const { title, author, identifier, manifest, spineIds } = parseOpf(opfXml);
  const baseDir = dirOf(opfPath);
  const workId = `${deriveWorkId(identifier)}@${hashEdition(bytes)}`;

  let globalOrdinal = 0;
  const chapters: ParsedChapter[] = [];
  const warnings: string[] = [];

  spineIds.forEach((spineId, spineIndex) => {
    const item = manifest.get(spineId);
    if (!item || item.mediaType !== "application/xhtml+xml") return;

    const path = resolveHref(baseDir, item.href);
    const xhtml = files[path] ? strFromU8(files[path]) : null;
    if (!xhtml) return;

    const { document } = parseHTML(xhtml);
    const chapterSections = findChapterSections(document);
    if (chapterSections.length === 0) return; // front/back matter, nav, etc. — not a chapter
    if (chapterSections.length > 1) {
      warnings.push(
        `${path}: found ${chapterSections.length} top-level <section epub:type="chapter"> ` +
          "elements; only the first was parsed, the rest were dropped",
      );
    }
    const chapterEl = chapterSections[0];

    const chapterOrdinal = chapters.length + 1;
    const subsectionEls = directChildren(chapterEl, "section");
    // A chapter with no nested <section> is itself one implicit section —
    // not every chapter is subdivided, even in a Standard Ebooks source.
    const sectionSources = subsectionEls.length > 0 ? subsectionEls : [chapterEl];

    const sections: ParsedSection[] = sectionSources.map((sectionEl, sectionIdx) => {
      const sectionOrdinal = sectionIdx + 1;
      const paragraphEls = directChildren(sectionEl, "p");

      const paragraphs: ParsedParagraph[] = paragraphEls.map((p, paragraphIdx) => {
        const paragraphOrdinal = paragraphIdx + 1;
        const elementPath = `${chapterOrdinal}/${sectionOrdinal}/${paragraphOrdinal}`;
        const { html, text } = sanitizeParagraph(p);
        globalOrdinal += 1;
        return {
          id: computeParagraphId(workId, spineIndex, elementPath),
          html,
          text,
          ordinal: paragraphOrdinal,
          globalOrdinal,
          wordCount: countWords(text),
        };
      });

      return {
        label: headingText(sectionEl) ?? String(sectionOrdinal),
        ordinal: sectionOrdinal,
        paragraphs,
      };
    });

    chapters.push({
      label: headingText(chapterEl) ?? `Chapter ${chapterOrdinal}`,
      ordinal: chapterOrdinal,
      sections,
    });
  });

  return { id: workId, title, author, chapters, warnings };
}
