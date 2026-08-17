import { lazy, Suspense, useState } from "react";
import styles from "./FootnoteMarker.module.css";

const RealFootnoteMarker = lazy(() =>
  import("./FootnoteMarker").then((m) => ({ default: m.FootnoteMarker })),
);

type Props = {
  label: string;
  bodyHtml: string;
};

// Matches FootnoteMarker's own PopoverButton className exactly, so
// swapping the placeholder for the real thing on activation is invisible —
// same Tailwind layout prefix, and the same imported CSS Module (not a
// second copy of it), so styles.marker resolves to the identical class.
const MARKER_CLASSNAME = [
  "inline cursor-pointer border-0 p-0",
  styles.marker,
].join(" ");

/**
 * @headlessui/react's Popover is exactly the kind of thing read.tsx
 * already keeps out of the initial bundle for RigLivePanel (see its own
 * lazy() there, against lighthouserc.cjs's script-size budget) — but
 * FootnoteMarker pulled it in unconditionally, for every footnote-bearing
 * paragraph mounted, whether or not a reader ever looks at one. Most
 * don't. This renders a plain, fully-focusable/tappable button carrying
 * the same digit and styling, and only imports the real popover — and
 * mounts it, already open — on the interaction that first asks for it.
 */
export function FootnoteMarkerLazy({ label, bodyHtml }: Props) {
  const [activated, setActivated] = useState(false);

  if (!activated) {
    const activate = () => setActivated(true);
    return (
      <button
        type="button"
        className={MARKER_CLASSNAME}
        onMouseEnter={activate}
        onFocus={activate}
        onClick={activate}
      >
        {label}
      </button>
    );
  }

  return (
    <Suspense fallback={<span className={MARKER_CLASSNAME}>{label}</span>}>
      <RealFootnoteMarker label={label} bodyHtml={bodyHtml} startOpen />
    </Suspense>
  );
}
