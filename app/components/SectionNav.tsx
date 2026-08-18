import { DisplayText } from "./DisplayText";

type Props = {
  /** Jumps to the previous section, or `null` at the work's first section. */
  onPrevious: (() => void) | null;
  /** Jumps to the next section, or `null` at the work's last section. */
  onNext: (() => void) | null;
  /** Stacked ↑/↓ instead of side-by-side ←/→ — the read page's vertical
   * margin rail (ReadingRail) runs down a column too narrow for the
   * horizontal pair. */
  vertical?: boolean;
};

/**
 * Prev/next controls for stepping between sections. Plain buttons, not
 * `Link`s: in the continuous-scroll reader (#51) every section already
 * lives in the same page, so "navigating" means scrolling the reading
 * column to a row that may already be mounted, not a route change. A
 * `null` handler means there's nowhere to go (the work's very first or
 * last section) — rendered as a disabled `.btn-icon` rather than omitted,
 * so the pair doesn't shift position as a reader approaches either edge.
 */
export function SectionNav({ onPrevious, onNext, vertical = false }: Props) {
  return (
    <div
      className={[
        "flex flex-none items-center gap-2",
        vertical ? "flex-col" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        disabled={!onPrevious}
        onClick={onPrevious ?? undefined}
        aria-label="Previous section"
      >
        <DisplayText text={vertical ? "↑" : "←"} />
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        disabled={!onNext}
        onClick={onNext ?? undefined}
        aria-label="Next section"
      >
        <DisplayText text={vertical ? "↓" : "→"} />
      </button>
    </div>
  );
}
