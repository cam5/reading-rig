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

/** Fixed id for the on-screen pill (see pillId): only one can exist in the
 * composer at a time, so TokenComposer can look it up directly by this
 * constant rather than by any particular candidate instance. */
export const ONSCREEN_PILL_ID = "onscreen";

/** Stable key for a candidate — the DOM's `data-pill-id`, pillDataRef's map
 * key, and the popup row's React key/aria id all use this same value.
 * "onscreen" is a fixed id rather than one derived from the range: only one
 * on-screen pill can exist in the composer at a time (TokenComposer only
 * offers the pinned row while none is present), so it never needs to be
 * distinguished from another. */
export function pillId(candidate: PillCandidate): string {
  switch (candidate.kind) {
    case "paragraph":
      return `paragraph:${candidate.passage.paragraphId}`;
    case "note":
      return `note:${candidate.note.entryId}`;
    case "onScreen":
      return ONSCREEN_PILL_ID;
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

/** The pill's on-screen label — what renders inside the tag itself. A note
 * is marked as one (its body reads like prose, not a quote, so without a
 * tag it'd be indistinguishable from a paragraph pill); the on-screen pill
 * leads with its own name rather than a locator, since "what's in view" is
 * the point of picking it, not where it is. */
export function pillLabel(candidate: PillCandidate): string {
  switch (candidate.kind) {
    case "paragraph":
      return `${candidate.passage.locator} "${truncateForPillLabel(candidate.passage.text)}"`;
    case "note":
      return `${candidate.note.locator} note: "${truncateForPillLabel(candidate.note.body)}"`;
    case "onScreen":
      return `In view (${candidate.excerpt.locator})`;
  }
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
 * pill with its source text quoted in place: `What does "A commodity
 * appears…" (§4 ¶3) mean here?` — the same `"<text>" (<locator>)` shape for
 * all three kinds, note pills included: a note quotes itself, not the
 * passage it was written against, the same way a paragraph pill quotes only
 * the paragraph.
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
      out += `"${pillSourceText(candidate)}" (${pillLocator(candidate)})`;
      continue;
    }
    // Not a pill: some wrapper the browser introduced on its own (a paste,
    // a stray <div>). Keep its text rather than dropping the line.
    out += serializeNodes(node.childNodes, pillData);
  }
  return out;
}
