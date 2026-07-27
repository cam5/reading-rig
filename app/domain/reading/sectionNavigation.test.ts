import { describe, expect, it } from "vitest";
import {
  type ChapterOutline,
  nextSectionRef,
  previousSectionRef,
  resolveSectionRef,
} from "./sectionNavigation";

// Shaped like the seeded dev fixture (build-capital-fixture.ts): one
// chapter, four sections — enough to exercise intra-chapter movement.
const oneChapter: ChapterOutline[] = [
  {
    id: "ch1",
    ordinal: 1,
    sections: [
      { id: "ch1-s1", ordinal: 1 },
      { id: "ch1-s2", ordinal: 2 },
      { id: "ch1-s3", ordinal: 3 },
      { id: "ch1-s4", ordinal: 4 },
    ],
  },
];

// The fixture only has one chapter, so rollover can't be exercised against
// it (see the PR body) — a synthetic second chapter here is the only way
// to unit-test the rollover boundary at all.
const twoChapters: ChapterOutline[] = [
  {
    id: "ch1",
    ordinal: 1,
    sections: [
      { id: "ch1-s1", ordinal: 1 },
      { id: "ch1-s2", ordinal: 2 },
    ],
  },
  {
    id: "ch2",
    ordinal: 2,
    sections: [
      { id: "ch2-s1", ordinal: 1 },
      { id: "ch2-s2", ordinal: 2 },
    ],
  },
];

describe("resolveSectionRef", () => {
  it("defaults to the first chapter's first section when no id is given", () => {
    expect(resolveSectionRef(oneChapter)).toEqual({ chapterId: "ch1", sectionId: "ch1-s1" });
  });

  it("resolves a valid section id to its owning chapter", () => {
    expect(resolveSectionRef(oneChapter, "ch1-s3")).toEqual({ chapterId: "ch1", sectionId: "ch1-s3" });
  });

  it("falls back to the default for an id that isn't in this work", () => {
    expect(resolveSectionRef(oneChapter, "some-other-work-section")).toEqual({
      chapterId: "ch1",
      sectionId: "ch1-s1",
    });
  });

  it("is null for a work with no sections at all", () => {
    expect(resolveSectionRef([])).toBeNull();
  });
});

describe("nextSectionRef", () => {
  it("steps to the next section within the same chapter", () => {
    expect(nextSectionRef(oneChapter, { chapterId: "ch1", sectionId: "ch1-s1" })).toEqual({
      chapterId: "ch1",
      sectionId: "ch1-s2",
    });
  });

  it("is null past the work's last section, single-chapter case", () => {
    expect(nextSectionRef(oneChapter, { chapterId: "ch1", sectionId: "ch1-s4" })).toBeNull();
  });

  it("rolls over into the next chapter's first section", () => {
    expect(nextSectionRef(twoChapters, { chapterId: "ch1", sectionId: "ch1-s2" })).toEqual({
      chapterId: "ch2",
      sectionId: "ch2-s1",
    });
  });

  it("is null past the work's actual last section, multi-chapter case", () => {
    expect(nextSectionRef(twoChapters, { chapterId: "ch2", sectionId: "ch2-s2" })).toBeNull();
  });
});

describe("previousSectionRef", () => {
  it("steps to the previous section within the same chapter", () => {
    expect(previousSectionRef(oneChapter, { chapterId: "ch1", sectionId: "ch1-s2" })).toEqual({
      chapterId: "ch1",
      sectionId: "ch1-s1",
    });
  });

  it("is null before the work's first section, single-chapter case", () => {
    expect(previousSectionRef(oneChapter, { chapterId: "ch1", sectionId: "ch1-s1" })).toBeNull();
  });

  it("rolls back into the previous chapter's last section", () => {
    expect(previousSectionRef(twoChapters, { chapterId: "ch2", sectionId: "ch2-s1" })).toEqual({
      chapterId: "ch1",
      sectionId: "ch1-s2",
    });
  });

  it("is null before the work's actual first section, multi-chapter case", () => {
    expect(previousSectionRef(twoChapters, { chapterId: "ch1", sectionId: "ch1-s1" })).toBeNull();
  });
});
