import type { OnScreenExcerpt } from "~/domain/paragraph/onScreenExcerpt";
import type { NoteMatch, Passage } from "~/rig/tools/shared";

/** Enough words to recognise the passage you picked, short enough that a
 * pill stays a pill rather than becoming the message. */
const PILL_LABEL_MAX_WORDS = 6;

export function truncateForPillLabel(text: string, maxWords = PILL_LABEL_MAX_WORDS): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}…`;
}

/**
 * Everything the composer can turn into a pill (#117 follow-up: unified
 * search and the "in view" token widened this from paragraph-only). Each
 * variant carries its own source data rather than a flattened common shape,
 * since a paragraph, a note, and an on-screen range each need different
 * fields for their row/pill/serialized text and there's no honest single
 * shape that fits all three without optional fields nothing else uses.
 */
export type PillCandidate =
  | { kind: "paragraph"; passage: Passage }
  | { kind: "note"; note: NoteMatch }
  | { kind: "onScreen"; excerpt: OnScreenExcerpt };

/** A candidate's *content* key — same value for two candidates describing
 * the same source, e.g. two "in view" reads of the same on-screen range.
 * Used for the popup row's React key/aria id, where that's exactly what's
 * wanted (there's only ever one on-screen row offered at a time, so nothing
 * there needs to tell two on-screen candidates apart). It is NOT what goes
 * in `data-pill-id` or pillDataRef's map key once a candidate is actually
 * inserted — see TokenComposer's insertSuggestion, which suffixes this with
 * a per-insertion counter instead. A paragraph or note pill can already
 * repeat within one message with nothing to stop it; the on-screen pill is
 * capped to one live pill per message (TokenComposer's suggestions memo),
 * but that cap resets every send, so it can still repeat across a
 * conversation's later messages. Either way, two live pills sharing a key
 * would make backspacing one clobber the other's recorded data. */
export function pillId(candidate: PillCandidate): string {
  switch (candidate.kind) {
    case "paragraph":
      return `paragraph:${candidate.passage.paragraphId}`;
    case "note":
      return `note:${candidate.note.entryId}`;
    case "onScreen":
      return "onscreen";
  }
}

function pillLocator(candidate: PillCandidate): string {
  switch (candidate.kind) {
    case "paragraph":
      return candidate.passage.locator;
    case "note":
      return candidate.note.locator;
    case "onScreen":
      return candidate.excerpt.locator;
  }
}

function pillSourceText(candidate: PillCandidate): string {
  switch (candidate.kind) {
    case "paragraph":
      return candidate.passage.text;
    case "note":
      return candidate.note.body;
    case "onScreen":
      return candidate.excerpt.text;
  }
}

/** The pill's on-screen label, from just the fields that survive a round
 * trip through the wire format (transcriptMarkers.ts's `⟦pill⟧` tag carries
 * exactly `kind`/`locator`/quoted text, nothing richer) — the single source
 * of wording for both the live composer's pills and the transcript's
 * collapsed ones. A note is marked as one (its body reads like prose, not a
 * quote, so without a tag it'd be indistinguishable from a paragraph pill);
 * the on-screen pill leads with its own name rather than a locator, since
 * "what's in view" is the point of picking it, not where it is. */
export function formatPillLabel(kind: PillCandidate["kind"], locator: string, text: string): string {
  switch (kind) {
    case "paragraph":
      return `${locator} "${truncateForPillLabel(text)}"`;
    case "note":
      return `${locator} note: "${truncateForPillLabel(text)}"`;
    case "onScreen":
      return `In view (${locator})`;
  }
}

/** The pill's on-screen label — what renders inside the tag itself. */
export function pillLabel(candidate: PillCandidate): string {
  return formatPillLabel(candidate.kind, pillLocator(candidate), pillSourceText(candidate));
}

/**
 * A mention pill as a raw DOM node rather than a React component: it lives
 * inside TokenComposer's uncontrolled contentEditable, where React must
 * never own the subtree (re-rendering it resets the caret).
 *
 * The full candidate is carried in TokenComposer's side-table keyed by
 * `data-pill-id`, not in the attributes here — the id is the only thing
 * that has to survive a round trip through the DOM.
 */
export function createPillElement(candidate: PillCandidate): HTMLSpanElement {
  const pill = document.createElement("span");
  pill.contentEditable = "false";
  pill.dataset.pillId = pillId(candidate);
  pill.className = "tag tag-accent token-pill";
  pill.title = pillSourceText(candidate);
  pill.textContent = pillLabel(candidate);
  return pill;
}

/**
 * Flattens the composer's DOM into the string that gets sent, replacing each
 * pill with its source text quoted in place inside a `⟦pill kind="..."
 * locator="..."⟧...⟦/pill⟧` tag (transcriptMarkers.ts parses this back out
 * into a collapsed pill for the transcript) — the same tag shape for all
 * three kinds, note pills included: a note quotes itself, not the passage
 * it was written against, the same way a paragraph pill quotes only the
 * paragraph.
 *
 * Quoting in place rather than appending afterward is the whole point of
 * inline pills — what's on screen is literally where the quoted text lands
 * in what the Rig receives.
 */
export function serializeComposer(root: HTMLElement, pillData: Map<string, PillCandidate>): string {
  return serializeNodes(root.childNodes, pillData).trim();
}

function serializeNodes(nodes: NodeListOf<ChildNode>, pillData: Map<string, PillCandidate>): string {
  let out = "";
  for (const node of Array.from(nodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      continue;
    }
    if (!(node instanceof HTMLElement)) continue;
    if (node.tagName === "BR") {
      out += "\n";
      continue;
    }
    const id = node.dataset.pillId;
    const candidate = id ? pillData.get(id) : undefined;
    if (candidate) {
      out += `⟦pill kind="${candidate.kind}" locator="${pillLocator(candidate)}"⟧${pillSourceText(candidate)}⟦/pill⟧`;
      continue;
    }
    // Not a pill: some wrapper the browser introduced on its own (a paste,
    // a stray <div>). Keep its text rather than dropping the line.
    out += serializeNodes(node.childNodes, pillData);
  }
  return out;
}
