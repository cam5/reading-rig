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
};

/** The reader's top bar: title, progress readout, section nav, and the Reading/Commonplace switch. */
export function ReaderHeader({ workId, workTitle, progressPercent, timeLeft, onPreviousSection, onNextSection }: Props) {
  return (
    <header className="flex flex-none items-center gap-4 px-6 py-4">
      <span className="font-heading text-lg">
        <DisplayText text="Reading Rig" />
      </span>
      <span className="text-[13px] opacity-60">{workTitle}</span>
      <span className="ml-auto text-[11px] uppercase tracking-wide opacity-45">
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
    </header>
  );
}
