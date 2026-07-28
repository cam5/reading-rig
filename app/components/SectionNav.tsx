type Props = {
  /** Jumps to the previous section, or `null` at the work's first section. */
  onPrevious: (() => void) | null;
  /** Jumps to the next section, or `null` at the work's last section. */
  onNext: (() => void) | null;
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
export function SectionNav({ onPrevious, onNext }: Props) {
  return (
    <div className="flex flex-none items-center gap-2">
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        disabled={!onPrevious}
        onClick={onPrevious ?? undefined}
        aria-label="Previous section"
      >
        ←
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        disabled={!onNext}
        onClick={onNext ?? undefined}
        aria-label="Next section"
      >
        →
      </button>
    </div>
  );
}
