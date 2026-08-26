import { useEffect } from "react";

type Props = {
  /** `null` at the very first/last page — same "disabled, not omitted, so
   * the pair doesn't shift" contract most prev/next UIs use. */
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  previousLabel?: string;
  nextLabel?: string;
  /** Applied to the wrapping row. */
  className?: string;
  /** Applied to each button — this package has no opinion on your button
   * styling, so it ships bare `<button>`s and lets you hand in whatever
   * class names your own design system uses. */
  buttonClassName?: string;
};

/**
 * Prev/next controls for a `usePagedColumns` reader. Plain buttons, not
 * links — a page turn is client-side windowing state, not a navigation.
 *
 * Also owns ArrowLeft/ArrowRight keyboard handling, ignored while focus is
 * inside an editable control (an input, a textarea, `contenteditable`) so
 * paging doesn't hijack ordinary text editing elsewhere on the page.
 */
export function PagedNavControls({
  onPrevious,
  onNext,
  previousLabel = "Previous page",
  nextLabel = "Next page",
  className,
  buttonClassName,
}: Props) {
  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA"
      );
    }

    function onKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      if (event.key === "ArrowLeft" && onPrevious) {
        event.preventDefault();
        onPrevious();
      } else if (event.key === "ArrowRight" && onNext) {
        event.preventDefault();
        onNext();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onPrevious, onNext]);

  return (
    <div className={className}>
      <button
        type="button"
        className={buttonClassName}
        disabled={!onPrevious}
        onClick={onPrevious ?? undefined}
        aria-label={previousLabel}
      >
        {"←"}
      </button>
      <button
        type="button"
        className={buttonClassName}
        disabled={!onNext}
        onClick={onNext ?? undefined}
        aria-label={nextLabel}
      >
        {"→"}
      </button>
    </div>
  );
}
