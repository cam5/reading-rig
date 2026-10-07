import { EpubParseError, type EpubParseErrorReason } from "./parseEpub";

const NOT_AN_EPUB_MESSAGE =
  "That file isn't a valid EPUB — it may be corrupt or a different format (PDF and MOBI aren't supported yet). Try re-downloading it.";

// Reader copy for each failure parseEpub can name. The three "not an EPUB"
// reasons share one message on purpose — which zip entry was missing isn't
// something a reader can act on differently.
const PARSE_ERROR_MESSAGES: Record<EpubParseErrorReason, string> = {
  "not-a-zip": NOT_AN_EPUB_MESSAGE,
  "missing-container": NOT_AN_EPUB_MESSAGE,
  "missing-package": NOT_AN_EPUB_MESSAGE,
  "too-large": "That EPUB is too large once unpacked. Try a different edition.",
};

/** What upload.tsx's action shows a reader when parseEpub throws. Kept out
 * of the route module itself so it's testable without a request, and so
 * the route exports nothing but its loader/action/component. */
export function epubParseErrorMessage(error: unknown): string {
  if (error instanceof EpubParseError) {
    return PARSE_ERROR_MESSAGES[error.reason];
  }
  // Anything else malformed can throw a raw TypeError from partway through
  // the DOM walk — the zip and container were fine, so it's the book's own
  // contents this parser couldn't follow.
  return "That EPUB couldn't be read — its contents aren't laid out the way this reader expects. Try a different edition of the book.";
}
