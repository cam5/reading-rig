import { Link } from "react-router";
import { DisplayText } from "./DisplayText";
import { SectionNav } from "./SectionNav";

type Props = {
  workId: string;
  workTitle: string;
  progressPercent: number;
  timeLeft: string;
  /** Jumps to the previous section, or `null` at the work's first section. */
  onPreviousSection: (() => void) | null;
  /** Jumps to the next section, or `null` at the work's last section. */
  onNextSection: (() => void) | null;
  /** Opens the marginalia drawer. Only below `desk`, where it isn't already beside the text. */
  onOpenMargin: () => void;
};

/** The reader's top bar: title, progress readout, section nav, and the Reading/Commonplace switch. */
export function ReaderHeader({
  workId,
  workTitle,
  progressPercent,
  timeLeft,
  onPreviousSection,
  onNextSection,
  onOpenMargin,
}: Props) {
  return (
    // Wraps rather than overflows: below `sm` the app's own name gives way
    // (the work's title is what a reader needs), and the title truncates
    // instead of pushing the controls off the edge. `flex-1` on the title
    // does the job `ml-auto` on the readout used to — everything after it
    // still sits right, at every width.
    <header className="flex flex-none flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 sm:py-4">
      <span className="hidden font-heading text-lg sm:inline">
        <DisplayText text="Reading Rig" />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] opacity-60">{workTitle}</span>
      <span className="text-[11px] uppercase tracking-wide opacity-45">
        {progressPercent}% · {timeLeft}
      </span>
      <SectionNav onPrevious={onPreviousSection} onNext={onNextSection} />
      <div className="seg">
        <Link
          to={`/read/${workId}`}
          className="seg-opt"
          style={{ background: "var(--color-accent)", color: "var(--color-bg)" }}
        >
          Reading
        </Link>
        <Link to="/commonplace" className="seg-opt border-l border-divider">
          Commonplace
        </Link>
      </div>
      {/* The `desk:hidden` sits on a wrapper rather than on the button:
          organic.css is imported unlayered, so its `.btn { display:
          inline-flex }` outranks any Tailwind display utility on the same
          element no matter the breakpoint (unlayered styles beat layered
          ones outright — this renders as a visible button at 1440px
          otherwise). The wrapper has no `.btn` of its own to lose to. */}
      <span className="desk:hidden">
        <button type="button" className="btn btn-secondary" onClick={onOpenMargin}>
          <DisplayText text="Marginalia" />
        </button>
      </span>
    </header>
  );
}
