import { DisplayText } from "./DisplayText";
import { Kicker } from "./Kicker";
import { SectionNav } from "./SectionNav";
import { SegTab } from "./SegTab";
import styles from "./ReaderHeader.module.css";

type Props = {
  workId: string;
  workTitle: string;
  progressPercent: number;
  timeLeft: string;
  /** Jumps to the previous section, or `null` at the work's first section. */
  onPreviousSection: (() => void) | null;
  /** Jumps to the next section, or `null` at the work's last section. */
  onNextSection: (() => void) | null;
  /** Opens the live Rig panel — see RigLivePanel, rendered by the route
   * that owns this header. Just a launcher here: the header itself has no
   * opinion on whether the panel is open. */
  onOpenRig: () => void;
};

/** The reader's top bar: title, progress readout, section nav, the Rig launcher, and the Reading/Commonplace switch. */
export function ReaderHeader({
  workId,
  workTitle,
  progressPercent,
  timeLeft,
  onPreviousSection,
  onNextSection,
  onOpenRig,
}: Props) {
  return (
    <header className="flex flex-none items-center gap-4 px-6 py-4">
      <span className={["font-heading", styles.title].join(" ")}>
        <DisplayText text="Reading Rig" />
      </span>
      <span className={styles.workTitle}>{workTitle}</span>
      <Kicker tone="muted" className="ml-auto">
        {progressPercent}% · {timeLeft}
      </Kicker>
      <SectionNav onPrevious={onPreviousSection} onNext={onNextSection} />
      <button
        type="button"
        className={["btn btn-secondary", styles.askRig].join(" ")}
        onClick={onOpenRig}
      >
        <DisplayText text="Ask the Rig" />
      </button>
      <div className="seg">
        <SegTab to={`/read/${workId}`} active>
          Reading
        </SegTab>
        <SegTab to="/commonplace">Commonplace</SegTab>
      </div>
    </header>
  );
}
