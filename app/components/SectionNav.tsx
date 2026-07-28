import { Link } from "react-router";

type Props = {
  /** Full href (including `?section=`) to the previous section, or `null` at the work's first section. */
  previousHref: string | null;
  /** Full href to the next section, or `null` at the work's last section. */
  nextHref: string | null;
};

/**
 * Prev/next controls for stepping between sections. A `null` href means
 * there's nowhere to go (the work's very first or last section) — rendered
 * as a disabled `.btn-icon` rather than omitted, so the pair doesn't shift
 * position as a reader approaches either edge.
 */
export function SectionNav({ previousHref, nextHref }: Props) {
  return (
    <div className="flex flex-none items-center gap-2">
      {previousHref ? (
        <Link to={previousHref} className="btn btn-ghost btn-icon" aria-label="Previous section">
          ←
        </Link>
      ) : (
        <button type="button" className="btn btn-ghost btn-icon" disabled aria-label="Previous section">
          ←
        </button>
      )}
      {nextHref ? (
        <Link to={nextHref} className="btn btn-ghost btn-icon" aria-label="Next section">
          →
        </Link>
      ) : (
        <button type="button" className="btn btn-ghost btn-icon" disabled aria-label="Next section">
          →
        </button>
      )}
    </div>
  );
}
