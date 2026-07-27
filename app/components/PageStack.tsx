type Side = "read" | "toGo";

type Props = {
  /** Fraction of the work read so far, 0-1. Drives both stacks: this component only draws one side. */
  progress: number;
  /** Which half of the book this instance draws. "read" fans its leaves toward the left (spine on the right); "toGo" fans toward the right (spine on the left). */
  side: Side;
  /** Pixel thickness of the stack when it holds the whole book (frac = 1). Default 46, matching the source design. */
  maxWidth?: number;
  /** Hairlines drawn at full thickness. Default 26. */
  leaves?: number;
  /** >1 packs leaves tighter near the spine. Default 1.75. */
  splay?: number;
  /** How far leaves shorten toward the fore-edge, in the 0-1.5 range. Default 0.5. */
  curl?: number;
  className?: string;
};

/**
 * The fore-edge of one half of an open book, seen from above: spine at one
 * side, leaves packed tight near it and loosening toward the fore-edge as
 * the paper falls away from the binding. Two instances — side="read" and
 * side="toGo" — flank the reading column so their spines meet at the text;
 * the thickness of each stack is the progress readout, no bar needed.
 *
 * Ported from the design's RealBookImplicitProgressByPages (design/RealBookImplicitProgressByPages.dc.html).
 */
export function PageStack({
  progress,
  side,
  maxWidth = 46,
  leaves = 26,
  splay = 1.75,
  curl = 0.5,
  className = "",
}: Props) {
  const p = Math.min(1, Math.max(0, progress));
  const isRead = side === "read";
  const frac = isRead ? p : 1 - p;
  const w = maxWidth * frac;
  const n = Math.max(2, Math.round(leaves * frac));

  const leafStyles = Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n; // 0 at spine -> 1 at fore-edge
    const d = w * Math.pow(t, splay); // distance from the spine
    const inset = Math.pow(t, 1.3) * curl * 26; // spine-most leaf runs full height; leaves fall short outward
    const opacityPct = (0.05 + t * 0.16) * 100;
    return {
      position: "absolute" as const,
      width: 1,
      top: inset,
      bottom: inset,
      [isRead ? "right" : "left"]: d,
      background: `color-mix(in srgb, var(--color-text) ${opacityPct.toFixed(1)}%, transparent)`,
      borderRadius: 1,
    };
  });

  const coverInset = curl * 26 - 3;
  const coverStyle = {
    position: "absolute" as const,
    top: coverInset,
    bottom: coverInset,
    width: 2,
    [isRead ? "right" : "left"]: w,
    background: "color-mix(in srgb, var(--color-text) 28%, transparent)",
    borderRadius: 2,
  };

  const spineStyle = {
    position: "absolute" as const,
    top: 0,
    bottom: 0,
    width: 1,
    [isRead ? "right" : "left"]: 0,
    background: "color-mix(in srgb, var(--color-text) 10%, transparent)",
  };

  return (
    <div
      className={className}
      style={{ position: "relative", height: "100%", width: maxWidth }}
    >
      {leafStyles.map((style, i) => (
        <div key={i} style={style} />
      ))}
      <div style={coverStyle} />
      <div style={spineStyle} />
    </div>
  );
}
