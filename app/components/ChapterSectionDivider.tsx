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
      // Only meaningful under CSS fragmentation (paged mode's multi-column
      // flow, lib/paged-columns) — a no-op in scroll mode's own ordinary
      // block layout, so no mode branch is needed here. `breakInside`
      // keeps this short, atomic heading from itself being split across a
      // column boundary; `breakAfter` keeps it glued to whatever paragraph
      // follows it, so a page never ends with "Ch. 4 · §1" alone at the
      // bottom and that section's first paragraph pushed to the next
      // page. Deliberately not applied to ReadingParagraph — a paragraph
      // taller than one page is supposed to continue onto the next one,
      // which `break-inside: avoid` would prevent.
      //
      // Chrome (108+) is the only engine that honors `break-after` in a
      // multi-column (as opposed to paged-media/print) context as of this
      // writing — Safari and Firefox both ignore it here. Real, worthwhile
      // improvement where it's supported; not a cross-browser guarantee.
      // See lib/paged-columns/README.md.
      style={{ breakInside: "avoid-column", breakAfter: "avoid-column" }}
    >
      <Kicker tone="accent">
        Ch. {chapterOrdinal} · §{sectionOrdinal}
      </Kicker>
      <span className="h-px flex-1 bg-divider" />
    </div>
  );
}
