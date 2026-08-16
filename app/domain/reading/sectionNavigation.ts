export type SectionOutline = { id: string; ordinal: number };
export type ChapterOutline = {
  id: string;
  ordinal: number;
  sections: SectionOutline[];
};
export type SectionRef = { chapterId: string; sectionId: string };

/**
 * Which chapter/section a reader lands on: the one named by `sectionId` if
 * it actually belongs to this work, otherwise the work's first chapter and
 * first section — the same fallback the loader used unconditionally before
 * navigation existed, now also the landing spot for an absent or stale
 * (e.g. copy-pasted from a different work) query param.
 *
 * `chapters` must already be ordinal-ordered (the loader's own `orderBy`)
 * — this walks the array in place rather than re-sorting it.
 */
export function resolveSectionRef(
  chapters: ChapterOutline[],
  sectionId?: string | null,
): SectionRef | null {
  if (sectionId) {
    for (const chapter of chapters) {
      if (chapter.sections.some((s) => s.id === sectionId)) {
        return { chapterId: chapter.id, sectionId };
      }
    }
  }
  const firstChapter = chapters[0];
  const firstSection = firstChapter?.sections[0];
  return firstChapter && firstSection
    ? { chapterId: firstChapter.id, sectionId: firstSection.id }
    : null;
}

/**
 * The section one step forward from `current`: the next section in the
 * same chapter, or — once its last section is behind you — the first
 * section of the next chapter. `null` past the work's very last section,
 * which the UI reads as "disable the button" rather than wrapping around.
 */
export function nextSectionRef(
  chapters: ChapterOutline[],
  current: SectionRef,
): SectionRef | null {
  const chapterIndex = chapters.findIndex((c) => c.id === current.chapterId);
  if (chapterIndex === -1) return null;
  const chapter = chapters[chapterIndex];
  const sectionIndex = chapter.sections.findIndex(
    (s) => s.id === current.sectionId,
  );
  if (sectionIndex === -1) return null;

  if (sectionIndex + 1 < chapter.sections.length) {
    return {
      chapterId: chapter.id,
      sectionId: chapter.sections[sectionIndex + 1].id,
    };
  }
  const nextChapter = chapters[chapterIndex + 1];
  const nextSection = nextChapter?.sections[0];
  return nextChapter && nextSection
    ? { chapterId: nextChapter.id, sectionId: nextSection.id }
    : null;
}

/** The mirror of {@link nextSectionRef}: one step back, rolling into the
 * previous chapter's last section rather than its first. */
export function previousSectionRef(
  chapters: ChapterOutline[],
  current: SectionRef,
): SectionRef | null {
  const chapterIndex = chapters.findIndex((c) => c.id === current.chapterId);
  if (chapterIndex === -1) return null;
  const chapter = chapters[chapterIndex];
  const sectionIndex = chapter.sections.findIndex(
    (s) => s.id === current.sectionId,
  );
  if (sectionIndex === -1) return null;

  if (sectionIndex > 0) {
    return {
      chapterId: chapter.id,
      sectionId: chapter.sections[sectionIndex - 1].id,
    };
  }
  const previousChapter = chapters[chapterIndex - 1];
  const previousSection =
    previousChapter?.sections[previousChapter.sections.length - 1];
  return previousChapter && previousSection
    ? { chapterId: previousChapter.id, sectionId: previousSection.id }
    : null;
}
