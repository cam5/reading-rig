import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  /** Organic's `.btn-icon` — a square, label-less button (e.g. the `→` send button in 2a). */
  icon?: boolean;
};

const variantClass: Record<Variant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
};

/**
 * A thin wrapper over Organic's own `.btn` classes — see
 * design/_ds/organic-.../readme.md. We do not invent a parallel button
 * styling here; this component exists so React call sites get variant
 * props instead of memorising class name strings.
 */
export function Button({
  variant = "primary",
  icon = false,
  className = "",
  ...props
}: Props) {
  const classes = ["btn", variantClass[variant], icon && "btn-icon", className]
    .filter(Boolean)
    .join(" ");
  return <button className={classes} {...props} />;
}
