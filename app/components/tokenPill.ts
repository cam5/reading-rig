import type { Passage } from "~/rig/tools/shared";

/** Enough words to recognise the passage you picked, short enough that a
 * pill stays a pill rather than becoming the message. */
const PILL_LABEL_MAX_WORDS = 6;

export function truncateForPillLabel(text: string, maxWords = PILL_LABEL_MAX_WORDS): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}…`;
}

/**
 * A mention pill as a raw DOM node rather than a React component: it lives
 * inside TokenComposer's uncontrolled contentEditable, where React must
 * never own the subtree (re-rendering it resets the caret).
 *
 * The full passage is carried in TokenComposer's side-table keyed by
 * `data-paragraph-id`, not in the attributes here — the id is the only thing
 * that has to survive a round trip through the DOM.
 */
export function createPillElement(passage: Passage): HTMLSpanElement {
  const pill = document.createElement("span");
  pill.contentEditable = "false";
  pill.dataset.paragraphId = passage.paragraphId;
  pill.className = "tag tag-accent token-pill";
  pill.title = passage.text;
  pill.textContent = `${passage.locator} "${truncateForPillLabel(passage.text)}"`;
  return pill;
}

/**
 * Flattens the composer's DOM into the string that gets sent, replacing each
 * pill with its passage quoted in place: `What does "A commodity appears…"
 * (§4 ¶3) mean here?`
 *
 * Quoting in place rather than appending the passages after the message is
 * the whole point of inline pills — what's on screen is literally where the
 * quoted text lands in what the Rig receives.
 */
export function serializeComposer(root: HTMLElement, pillData: Map<string, Passage>): string {
  return serializeNodes(root.childNodes, pillData).trim();
}

function serializeNodes(nodes: NodeListOf<ChildNode>, pillData: Map<string, Passage>): string {
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
    const paragraphId = node.dataset.paragraphId;
    const passage = paragraphId ? pillData.get(paragraphId) : undefined;
    if (passage) {
      out += `"${passage.text}" (${passage.locator})`;
      continue;
    }
    // Not a pill: some wrapper the browser introduced on its own (a paste,
    // a stray <div>). Keep its text rather than dropping the line.
    out += serializeNodes(node.childNodes, pillData);
  }
  return out;
}
