import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import { unzipSync, strFromU8 } from "fflate";
import { computeParagraphId } from "./paragraphId";
import { sanitizeFootnoteBody, sanitizeParagraph } from "./sanitizeHtml";
import { countWords } from "../reading/readingTime";
import type {
  ParsedChapter,
  ParsedFootnote,
  ParsedParagraph,
  ParsedSection,
  ParsedWork,
} from "./types";

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

type ManifestItem = {
  href: string;
  mediaType: string | null;
  properties: string[];
};

/** The manifest item id for the cover image: EPUB3 marks it with
 * `properties="cover-image"` on the <item> itself; EPUB2 instead points at
 * it indirectly via `<meta name="cover" content="{manifest id}">`. Tried in
 * that order since a file could in principle carry both (a converted EPUB2
 * source) — the EPUB3 property is the more direct, unambiguous signal. */
function findCoverManifestId(
  document: Document,
  manifest: Map<string, ManifestItem>,
): string | null {
  for (const [id, item] of manifest) {
    if (item.properties.includes("cover-image")) return id;
  }
  const legacyId = byTag(document, "meta")
    .find((el) => el.getAttribute("name") === "cover")
    ?.getAttribute("content");
  return legacyId && manifest.has(legacyId) ? legacyId : null;
}

function parseOpf(opfXml: string) {
  const { document } = parseHTML(opfXml);

  const title =
    firstByTag(document, "dc:title")?.textContent?.trim() ?? "Untitled";
  const author =
    firstByTag(document, "dc:creator")?.textContent?.trim() ?? null;
  const identifier =
    firstByTag(document, "dc:identifier")?.textContent?.trim() ?? title;

  const manifest = new Map<string, ManifestItem>();
  for (const item of byTag(document, "item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) {
      manifest.set(id, {
        href,
        mediaType: item.getAttribute("media-type"),
        properties: (item.getAttribute("properties") ?? "")
          .split(/\s+/)
          .filter(Boolean),
      });
    }
  }

  const spineIds = byTag(document, "itemref")
    .map((el) => el.getAttribute("idref"))
    .filter((id): id is string => Boolean(id));

  const coverId = findCoverManifestId(document, manifest);

  return { title, author, identifier, manifest, spineIds, coverId };
}

/** Every outer chapter <section> in the file — every one whose epub:type
 * includes "chapter". Files with none (titlepage, imprint, colophon, nav,
 * ...) aren't reading content and are skipped by the caller; files with
 * more than one are a structural surprise the caller must warn about, not
 * silently resolve by picking the first and dropping the rest. */
function findChapterSections(document: Document): Element[] {
  return byTag(document, "section").filter((el) =>
    epubTypeTokens(el).includes("chapter"),
  );
}

/** The back-matter <section epub:type="endnotes"> (or legacy "footnotes")
 * in a file — the separate-spine-file footnote-body convention #138
 * targets. Not every work has one; the caller treats a miss as "no
 * footnotes in this file," not an error. */
function findEndnoteSection(document: Document): Element | null {
  return (
    byTag(document, "section").find((el) => {
      const tokens = epubTypeTokens(el);
      return tokens.includes("endnotes") || tokens.includes("footnotes");
    }) ?? null
  );
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

type ParagraphSource =
  | { kind: "prose"; el: Element; isBlockquote: boolean }
  | { kind: "sceneBreak" };

/**
 * Walks a chapter/section element's children in document order, collecting
 * every paragraph-worthy node — not just direct-child <p>s. A <blockquote>
 * (a letter, a quoted document — see #139) isn't content itself, it's a
 * wrapper; its own <p> children (including ones nested inside a <footer>
 * signature block) are recursed into and collected the same as any other
 * paragraph, just flagged so the reader can render them distinctly. An
 * <hr> scene break becomes an explicit marker row rather than vanishing
 * and letting the paragraphs on either side silently concatenate.
 *
 * Nested <section> elements are deliberately not descended into here —
 * the caller (parseEpub) already walks those separately as their own
 * ParsedSection, so recursing into them here would double-collect their
 * paragraphs.
 *
 * Anything else at this level (figure, table, ul/ol, dl, pre, ...) is
 * still out of scope for this pass (see #139's suggested scope) — logged
 * as a warning rather than dropped with no trace, so a future silent-loss
 * report has something concrete to point at.
 */
function collectParagraphSources(
  sectionEl: Element,
  warn: (message: string) => void,
): ParagraphSource[] {
  const sources: ParagraphSource[] = [];

  function walk(el: Element, insideBlockquote: boolean): void {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag === "p") {
        sources.push({
          kind: "prose",
          el: child,
          isBlockquote: insideBlockquote,
        });
      } else if (tag === "blockquote") {
        walk(child, true);
      } else if ((tag === "footer" || tag === "header") && insideBlockquote) {
        // A letter's dateline (<header>, e.g. "Hunsford, ... 15th October")
        // or signature (<footer>) — both are wrappers around more <p>s
        // inside the same blockquote, not content in their own right.
        walk(child, true);
      } else if (tag === "hr") {
        sources.push({ kind: "sceneBreak" });
      } else if (tag === "section") {
        // Handled separately by the caller as its own ParsedSection.
      } else if (
        tag === "h1" ||
        tag === "h2" ||
        tag === "h3" ||
        tag === "h4" ||
        tag === "h5" ||
        tag === "h6" ||
        tag === "hgroup"
      ) {
        // Handled separately by headingText() (which searches recursively,
        // reaching into an <hgroup> wrapper) — a chapter/section title,
        // not paragraph content.
      } else {
        warn(
          `unrecognized block-level element <${tag}> was skipped, not parsed as content`,
        );
      }
    }
  }

  walk(sectionEl, false);
  return sources;
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
  const { title, author, identifier, manifest, spineIds, coverId } =
    parseOpf(opfXml);
  const baseDir = dirOf(opfPath);
  const workId = `${deriveWorkId(identifier)}@${hashEdition(bytes)}`;

  let globalOrdinal = 0;
  const chapters: ParsedChapter[] = [];
  const warnings: string[] = [];

  let cover: ParsedWork["cover"] = null;
  if (coverId) {
    const coverItem = manifest.get(coverId)!;
    const coverPath = resolveHref(baseDir, coverItem.href);
    const coverBytes = files[coverPath];
    if (coverBytes) {
      cover = {
        bytes: coverBytes,
        mediaType: coverItem.mediaType ?? "application/octet-stream",
      };
    } else {
      warnings.push(
        `cover image manifest item "${coverId}" (${coverItem.href}) not found in the zip`,
      );
    }
  }
  // Every noteref marker found while walking paragraphs, in reading
  // order — joined against endnote bodies (found separately below) once
  // the whole spine has been walked, since the endnotes file is usually
  // its own spine item, processed independently of whichever chapter
  // file(s) actually reference it.
  const noterefOccurrences: { refId: string; paragraphId: string }[] = [];

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
    const sectionSources =
      subsectionEls.length > 0 ? subsectionEls : [chapterEl];

    const sections: ParsedSection[] = sectionSources.map(
      (sectionEl, sectionIdx) => {
        const sectionOrdinal = sectionIdx + 1;
        const paragraphSources = collectParagraphSources(sectionEl, (message) =>
          warnings.push(
            `${path} (chapter ${chapterOrdinal}, section ${sectionOrdinal}): ${message}`,
          ),
        );

        const paragraphs: ParsedParagraph[] = paragraphSources.map(
          (source, paragraphIdx) => {
            const paragraphOrdinal = paragraphIdx + 1;
            const elementPath = `${chapterOrdinal}/${sectionOrdinal}/${paragraphOrdinal}`;
            globalOrdinal += 1;

            if (source.kind === "sceneBreak") {
              return {
                kind: "sceneBreak",
                id: computeParagraphId(workId, spineIndex, elementPath),
                ordinal: paragraphOrdinal,
                globalOrdinal,
              };
            }

            const paragraphId = computeParagraphId(
              workId,
              spineIndex,
              elementPath,
            );
            const { html, text, footnoteRefIds } = sanitizeParagraph(source.el);
            for (const refId of footnoteRefIds) {
              noterefOccurrences.push({ refId, paragraphId });
            }
            return {
              kind: "prose",
              id: paragraphId,
              html,
              text,
              ordinal: paragraphOrdinal,
              globalOrdinal,
              wordCount: countWords(text),
              isBlockquote: source.isBlockquote,
            };
          },
        );

        return {
          label: headingText(sectionEl) ?? String(sectionOrdinal),
          ordinal: sectionOrdinal,
          paragraphs,
        };
      },
    );

    chapters.push({
      label: headingText(chapterEl) ?? `Chapter ${chapterOrdinal}`,
      ordinal: chapterOrdinal,
      sections,
    });
  });

  // A second, independent pass over the spine for the endnotes file — see
  // #138. Separate from the chapter loop above because it isn't a
  // chapter (findChapterSections returns none for it, so the loop above
  // already skips it) and there's exactly one such file per work, not one
  // per chapter.
  const endnoteBodies = new Map<string, { html: string; text: string }>();
  for (const spineId of spineIds) {
    const item = manifest.get(spineId);
    if (!item || item.mediaType !== "application/xhtml+xml") continue;
    const path = resolveHref(baseDir, item.href);
    const xhtml = files[path] ? strFromU8(files[path]) : null;
    if (!xhtml) continue;

    const { document } = parseHTML(xhtml);
    const endnoteSection = findEndnoteSection(document);
    if (!endnoteSection) continue;

    for (const li of byTag(endnoteSection, "li")) {
      const refId = li.getAttribute("id");
      if (!refId) continue;
      endnoteBodies.set(refId, sanitizeFootnoteBody(li));
    }
    break; // exactly one endnotes file expected; the rest of the spine is chapters
  }

  const footnotes: ParsedFootnote[] = [];
  noterefOccurrences.forEach((occurrence, i) => {
    const body = endnoteBodies.get(occurrence.refId);
    if (!body) {
      warnings.push(
        `noteref "${occurrence.refId}" (paragraph ${occurrence.paragraphId}) has no matching endnote body`,
      );
      return;
    }
    footnotes.push({
      paragraphId: occurrence.paragraphId,
      refId: occurrence.refId,
      html: body.html,
      text: body.text,
      ordinal: i + 1,
    });
    endnoteBodies.delete(occurrence.refId);
  });
  for (const orphanRefId of endnoteBodies.keys()) {
    warnings.push(
      `endnote "${orphanRefId}" has no matching noteref marker in any chapter`,
    );
  }

  return { id: workId, title, author, chapters, footnotes, cover, warnings };
}
