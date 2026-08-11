import type { CSSProperties } from "react";
import { pillId, type PillCandidate } from "./tokenPill";

type Props = {
  suggestions: PillCandidate[];
  activeIndex: number;
  loading: boolean;
  onSelect: (candidate: PillCandidate) => void;
  /** Runtime caret coordinates from TokenComposer — inline because they're
   * computed per keystroke, which is the one thing a class can't express. */
  style: CSSProperties;
  listboxId: string;
};

/** Shared with TokenComposer, which points `aria-activedescendant` at the
 * active row from outside this component's DOM subtree. */
export function optionId(id: string): string {
  return `mention-option-${id}`;
}

/** The row's leading tag — a locator for anything anchored to one place in
 * the book, plus a kind marker for the two rows a locator alone wouldn't
 * disambiguate (a note reads like prose, easy to mistake for the source
 * paragraph; the on-screen row has no single locator worth leading with). */
function suggestionTag(candidate: PillCandidate): string {
  switch (candidate.kind) {
    case "paragraph":
      return candidate.passage.locator;
    case "note":
      return `${candidate.note.locator} · note`;
    case "onScreen":
      return `📍 in view · ${candidate.excerpt.locator}`;
    // Unreachable: a "selection" candidate is seeded directly into the
    // composer (read.tsx's "Ask the Rig" over a selection), never offered
    // through this popup. Handled only so the switch stays exhaustive.
    case "selection":
      return candidate.locator;
  }
}

function suggestionPreview(candidate: PillCandidate): string {
  switch (candidate.kind) {
    case "paragraph":
      return candidate.passage.text;
    case "note":
      return candidate.note.body;
    case "onScreen":
      return candidate.excerpt.text;
    case "selection":
      return candidate.text;
  }
}

/**
 * The "@"-mention popup: presentational only, rendered into a portal by
 * TokenComposer (RigPanel's scrolling content area would clip it otherwise).
 *
 * Suggestions arrive already ranked, bookmark-filtered and capped — this
 * renders them in the order given, whichever mix of paragraphs, notes, and
 * the pinned on-screen row that turns out to be.
 */
export function MentionSuggestions({
  suggestions,
  activeIndex,
  loading,
  onSelect,
  style,
  listboxId,
}: Props) {
  return (
    <div
      id={listboxId}
      role="listbox"
      aria-label="What you've read"
      className="card elev-md fixed z-30 max-h-[240px] overflow-y-auto"
      style={style}
    >
      {suggestions.length === 0 ? (
        <p className="m-0 text-[12.5px] opacity-50">
          {loading ? "Looking through what you've read…" : "No matches before your bookmark"}
        </p>
      ) : (
        // Stale rows stay put while a later keystroke's request is in flight;
        // swapping the list for a loading line on every keystroke would make
        // the popup flicker under normal typing speed.
        suggestions.map((candidate, index) => {
          const id = pillId(candidate);
          return (
            <div
              key={id}
              id={optionId(id)}
              role="option"
              aria-selected={index === activeIndex}
              className={[
                "flex cursor-pointer items-baseline gap-2 rounded-[10px] px-2 py-1",
                index === activeIndex ? "bg-neutral-100" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              // Not onClick: a click's mousedown would move focus and blow
              // away the composer's selection before the caret offsets this
              // insertion depends on could be read.
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(candidate);
              }}
            >
              <span className="tag tag-accent flex-none">{suggestionTag(candidate)}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] opacity-80">{suggestionPreview(candidate)}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
