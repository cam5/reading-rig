import { selectionHandlePositions } from "./selectionHandlePosition";

type Props = {
  startRect: DOMRect;
  endRect: DOMRect;
};

/**
 * The pair of iOS-style handles bracketing a pending text selection — see
 * the `.selection-handle` doc comment in organic.css for what they're
 * mimicking and why they're decorative-only.
 */
export function SelectionHandles({ startRect, endRect }: Props) {
  const { start, end } = selectionHandlePositions(startRect, endRect);
  return (
    <>
      <div
        className="selection-handle selection-handle-start"
        style={{ left: start.left, top: start.top, height: start.height }}
      >
        <div className="selection-handle-knob" />
      </div>
      <div
        className="selection-handle selection-handle-end"
        style={{ left: end.left, top: end.top, height: end.height }}
      >
        <div className="selection-handle-knob" />
      </div>
    </>
  );
}
