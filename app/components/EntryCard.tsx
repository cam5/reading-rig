import { Kicker } from "./Kicker";
import styles from "./EntryCard.module.css";

type Props = {
  origin: "hand" | "rig";
  /** The display locator ("§4 ¶3") — derived, never stored, per
   * app/domain/locator.ts. */
  locator?: string;
  /** The passage this was saved against, if there is one. */
  excerpt?: string;
  /** When this was written, already formatted ("12 Mar") — the commonplace
   * book's context line trails with a date (3a); "Today's page" doesn't
   * pass one, since the whole pane is implicitly today. */
  date?: string;
  body: string;
  /** 1c's third "Today's page" card — a Rig entry surfaced by
   * association (Connect) rather than freshly made, shown at reduced
   * opacity. */
  dimmed?: boolean;
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * The one shape both the margin ("Today's page") and the commonplace book
 * render an Entry with — covering 1c's three states. Colour follows
 * invariant 1 from the kicker alone: terracotta for the Rig, sage for
 * "Your hand".
 */
export function EntryCard({
  origin,
  locator,
  excerpt,
  date,
  body,
  dimmed = false,
}: Props) {
  const kickerLabel = origin === "rig" ? "Rig" : "Your hand";
  const kickerTone = origin === "rig" ? "accent" : "accent-2";

  return (
    <div
      className={["bg-bg p-4", styles.card, dimmed ? styles.dimmed : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <Kicker tone={kickerTone} className="mb-2 block">
        {kickerLabel}
        {locator && ` · ${locator}`}
        {excerpt && ` · saved while reading "${truncate(excerpt, 48)}"`}
        {date && ` · ${date}`}
      </Kicker>
      <div className={["font-reading", styles.body].join(" ")}>{body}</div>
    </div>
  );
}
