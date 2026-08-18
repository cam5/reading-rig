import { SectionNav } from "./SectionNav";
import styles from "./ReadingRail.module.css";

type Props = {
  workTitle: string;
  progressPercent: number;
  timeLeft: string;
  /** Jumps to the previous section, or `null` at the work's first section. */
  onPreviousSection: (() => void) | null;
  /** Jumps to the next section, or `null` at the work's last section. */
  onNextSection: (() => void) | null;
};

/**
 * The margin that used to be ReaderHeader's top bar, now run down the
 * spine-side edge of the reading column instead — the work's title and its
 * reading progress as bottom-to-top vertical labels, book-fore-edge style,
 * with the section-step controls between them. Rig launching and the
 * Reading/Commonplace switch moved to MarginaliaSidebar's own header
 * instead of living here — this rail is read-page furniture only.
 */
export function ReadingRail({
  workTitle,
  progressPercent,
  timeLeft,
  onPreviousSection,
  onNextSection,
}: Props) {
  return (
    <div
      className={[
        "flex flex-none flex-col items-center justify-between",
        styles.rail,
      ].join(" ")}
    >
      <div className="flex flex-col items-center gap-4">
        <SectionNav
          vertical
          onPrevious={onPreviousSection}
          onNext={onNextSection}
        />
        <span className={styles.label}>{workTitle}</span>
      </div>
      <span className={styles.label}>
        {progressPercent}% · {timeLeft}
      </span>
    </div>
  );
}
