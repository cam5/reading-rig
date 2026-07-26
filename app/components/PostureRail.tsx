import { useRef } from "react";
import { nextPostureIndex, POSTURE_LABELS, POSTURE_ORDER, type PostureId } from "~/domain/postures";

type Props = {
  heldPosture: PostureId;
  onSelect: (posture: PostureId) => void;
};

/**
 * The lens rail (#7, made real by #27): a roving-tabindex radiogroup.
 * Clicking a posture (or moving the group with arrow/Home/End keys, per
 * nextPostureIndex's own contract) holds it — the held posture is a
 * parameter of the next turn to /rig, not a different agent invocation,
 * per the design's own framing ("picking a skill re-frames the same
 * question rather than sending a new one").
 */
export function PostureRail({ heldPosture, onSelect }: Props) {
  const railRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const currentIndex = POSTURE_ORDER.indexOf(heldPosture);
    const nextIndex = nextPostureIndex(currentIndex, event.key, POSTURE_ORDER.length);
    if (nextIndex === null) return;
    event.preventDefault();
    const nextPosture = POSTURE_ORDER[nextIndex];
    onSelect(nextPosture);
    railRef.current?.querySelector<HTMLButtonElement>(`[data-posture="${nextPosture}"]`)?.focus();
  }

  return (
    <div
      ref={railRef}
      role="radiogroup"
      aria-label="Lens — hold a posture over the passage"
      className="flex w-16 flex-none flex-col items-center gap-6 py-8"
      onKeyDown={handleKeyDown}
    >
      {POSTURE_ORDER.map((posture) => {
        const held = posture === heldPosture;
        return (
          <button
            key={posture}
            type="button"
            role="radio"
            aria-checked={held}
            data-posture={posture}
            tabIndex={held ? 0 : -1}
            onClick={() => onSelect(posture)}
            className="text-[11.5px] tracking-wide [writing-mode:vertical-rl]"
            style={
              held
                ? {
                    color: "var(--color-bg)",
                    background: "var(--color-accent)",
                    borderRadius: 999,
                    padding: "14px 7px",
                  }
                : { opacity: 0.6 }
            }
          >
            {POSTURE_LABELS[posture]}
          </button>
        );
      })}
    </div>
  );
}
