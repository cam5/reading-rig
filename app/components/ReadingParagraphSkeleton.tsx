import styles from "./ReadingParagraphSkeleton.module.css";

type Props = {
  id: string;
  /** What this row is *estimated* to occupy, in px — the same guess
   * useVirtualizedRows has in its height table for it.
   *
   * A skeleton used to be a fixed 3.2em regardless of the paragraph it
   * stood in for, which made it a worse height estimate than the one the
   * windowing math had already made, and an actively harmful one: a
   * skeleton mounting *above* the fold measured ~56px where a real
   * paragraph would have measured a few hundred, so the row list appeared
   * to collapse and everything below it slid up. Standing at the estimated
   * height instead means a row that hasn't loaded yet occupies exactly the
   * space the scroll math already reserved for it, and swapping in the
   * real content is a correction of a few px rather than a few hundred. */
  heightPx: number;
  className?: string;
  /** React 19 passes `ref` as an ordinary prop — same wiring
   * ReadingParagraph takes, so useVirtualizedRows' ResizeObserver still
   * corrects this row's height guess while its content hasn't loaded yet. */
  ref?: React.Ref<HTMLDivElement>;
};

/**
 * Stands in for a mounted-but-not-yet-content-fetched row — the DOM mount
 * window (useVirtualizedRows) can range ahead of what useContentWindow has
 * actually fetched, e.g. on a fast scroll. Carries the same `id` +
 * `data-paragraph-id` as ReadingParagraph on purpose: useBookmarkTracker's
 * DOM scan only ever needs a paragraph's structural fields (globalOrdinal,
 * wordCount, section), so it keeps treating this row as a real scroll-
 * position candidate even before its content arrives.
 */
export function ReadingParagraphSkeleton({
  id,
  heightPx,
  className = "",
  ref,
}: Props) {
  return (
    <div
      ref={ref}
      id={id}
      data-paragraph-id={id}
      style={{ height: heightPx }}
      className={["mb-5 animate-pulse", styles.skeleton, className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
