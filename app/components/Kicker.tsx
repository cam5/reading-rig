import type { HTMLAttributes } from "react";
import styles from "./Kicker.module.css";

type Tone = "accent" | "accent-2" | "muted";

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone: Tone;
};

const toneClass: Record<Tone, string> = {
  accent: styles.accent,
  "accent-2": styles.accentTwo,
  muted: styles.muted,
};

/**
 * The small, uppercase, letter-spaced label used for section/chapter
 * markers, entry/highlight provenance, and section headings across the
 * reading and commonplace views — the same idiom seven components used to
 * hand-roll independently. Any layout spacing around it (margin, etc.) is
 * the caller's concern, same as Tag/Button.
 */
export function Kicker({ tone, className = "", ...props }: Props) {
  const classes = [styles.kicker, toneClass[tone], className]
    .filter(Boolean)
    .join(" ");
  return <span className={classes} {...props} />;
}
