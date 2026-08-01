// The six postures from the design's lens rail (1c) and chip row (2a/2c).
// Purely decorative here — no selection state, no tool calls. Real posture
// invocation is M3's.
const POSTURES = ["Interrogate", "Steelman", "Connect", "Close-read", "Context", "Recap"];

/** The vertical strip of posture names beside the reading column. Static/decorative until M3. */
export function PostureRail() {
  return (
    <div className="flex w-16 flex-none flex-col items-center gap-6 py-8">
      {POSTURES.map((posture, i) => (
        <span
          key={posture}
          className="text-[11.5px] tracking-wide [writing-mode:vertical-rl]"
          style={
            i === 0
              ? { color: "var(--color-bg)", background: "var(--color-accent)", borderRadius: 999, padding: "14px 7px" }
              : { opacity: 0.6 }
          }
        >
          {posture}
        </span>
      ))}
    </div>
  );
}
