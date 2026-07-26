import type { HTMLAttributes } from "react";

type Variant = "accent" | "accent-2" | "neutral" | "outline";

type Props = HTMLAttributes<HTMLSpanElement> & {
  variant?: Variant;
};

const variantClass: Record<Variant, string> = {
  accent: "tag-accent",
  "accent-2": "tag-accent-2",
  neutral: "tag-neutral",
  outline: "tag-outline",
};

/**
 * Wraps Organic's `.tag` classes. This is a generic primitive — the design
 * brief's invariant 1 (terracotta is the machine's voice, sage is your hand
 * and your shelf) is a call-site decision, not something this component can
 * enforce: a future Entry or Highlight component should choose `accent` for
 * Rig-origin content and `accent-2` for hand-origin content, never the
 * reverse. `neutral` and `outline` are for anything uncoloured.
 */
export function Tag({ variant = "neutral", className = "", ...props }: Props) {
  const classes = [`tag ${variantClass[variant]}`, className]
    .filter(Boolean)
    .join(" ");
  return <span className={classes} {...props} />;
}
