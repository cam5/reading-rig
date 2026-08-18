import type { ComponentProps } from "react";
import { Link } from "react-router";
import styles from "./SegTab.module.css";

type Props = ComponentProps<typeof Link> & {
  active?: boolean;
};

/**
 * One tab of a Link-based `.seg` (the Reading/Commonplace switch, shown in
 * both MarginaliaSidebar's own header and commonplace.tsx). Organic's own
 * `.seg-opt:has(input:checked)` only lights up a real radio input's
 * sibling — there's no input here to match, since navigating between two
 * routes isn't a form control — so this is the modifier for that case
 * instead of each call site inline-styling its own active background.
 */
export function SegTab({ active = false, className = "", ...props }: Props) {
  const classes = ["seg-opt", active ? styles.active : "", className]
    .filter(Boolean)
    .join(" ");
  return <Link className={classes} {...props} />;
}
