type Props = {
  chapterOrdinal: number;
  sectionOrdinal: number;
  className?: string;
  /** React 19 ref-as-prop — the virtualized reading column measures this
   * like any other row so its height counts toward the scroll spacers. */
  ref?: React.Ref<HTMLDivElement>;
};

/**
 * A chapter/section boundary marker, inline in the continuous reading
 * flow. Previously read.tsx rendered one of these once, above whichever
 * section happened to be server-paginated in; now every section boundary
 * in the whole work gets one, so it has to be its own row — measured and
 * virtualized exactly like a paragraph (see useVirtualizedRows) rather
 * than page furniture the loader renders once.
 */
export function ChapterSectionDivider({
  chapterOrdinal,
  sectionOrdinal,
  className = "",
  ref,
}: Props) {
  return (
    <div
      ref={ref}
      className={["mb-6 flex items-baseline gap-3", className]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="text-[10.5px] uppercase tracking-wide text-[var(--color-accent)]">
        Ch. {chapterOrdinal} · §{sectionOrdinal}
      </span>
      <span className="h-px flex-1 bg-divider" />
    </div>
  );
}
