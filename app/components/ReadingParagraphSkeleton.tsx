type Props = {
  id: string;
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
export function ReadingParagraphSkeleton({ id, className = "", ref }: Props) {
  return (
    <div
      ref={ref}
      id={id}
      data-paragraph-id={id}
      className={["mb-5 h-[3.2em] animate-pulse rounded bg-neutral-200", className].filter(Boolean).join(" ")}
    />
  );
}
