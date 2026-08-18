import { Kicker } from "./Kicker";

type Props = {
  /** The divider's own row id (`divider:<sectionId>`), emitted as the
   * element's `id` so a section boundary is addressable from the DOM the
   * same way a paragraph is — useVirtualizedRows already tracks it by this
   * id internally, but without it on the element nothing outside the hook
   * (a test, a scroll assertion) can find where a section actually starts. */
  id: string;
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
  id,
  chapterOrdinal,
  sectionOrdinal,
  className = "",
  ref,
}: Props) {
  return (
    <div
      ref={ref}
      id={id}
      className={["mb-6 flex items-baseline gap-3", className]
        .filter(Boolean)
        .join(" ")}
    >
      <Kicker tone="accent">
        Ch. {chapterOrdinal} · §{sectionOrdinal}
      </Kicker>
      <span className="h-px flex-1 bg-divider" />
    </div>
  );
}
