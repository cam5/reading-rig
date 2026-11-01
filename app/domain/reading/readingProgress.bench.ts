import { bench, describe } from "vitest";
import { computeReadingProgress } from "./readingProgress";

// `npx vitest bench app/domain/reading/readingProgress.bench.ts` — the
// per-settle / per-page-turn cost resolveBookmarkFromCandidates pays, and
// the per-prepend cost scroll mode used to pay for paged mode's idle
// usePagedColumns. "before" re-states #212's own code inline for
// comparison; "after" is what ships.
const N = 5000;
const record = Object.fromEntries(
  Array.from({ length: N }, (_, i) => [
    `p${i}`,
    {
      globalOrdinal: i + 1,
      wordCount: 50 + ((i * 37) % 300),
      section: { chapterId: "c", sectionId: `s${i >> 6}` },
    },
  ]),
);
const list = Object.values(record);
const bookmark = N / 2;

describe(`resolve progress readout, ${N} paragraphs`, () => {
  bench("before: Object.values + filter/reduce per resolve", () => {
    const ps = Object.values(record);
    ps.filter((p) => p.globalOrdinal > bookmark).reduce(
      (sum, p) => sum + p.wordCount,
      0,
    );
  });
  bench("after: cached list + single loop", () => {
    computeReadingProgress(list, N, bookmark);
  });
});

const rows = list.map((p, i) => ({ id: `p${i}`, h: p.wordCount }));
const NO_ITEMS: { id: string; estimatedSizePx: number }[] = [];
describe(`scroll mode's idle paged hook, per prepend, ${N} rows`, () => {
  bench("before: zip pagedItems + rebuild id→index Map", () => {
    const items = rows.map((r) => ({ id: r.id, estimatedSizePx: r.h }));
    new Map(items.map((item, i) => [item.id, i]));
  });
  bench("after: shared empty list", () => {
    new Map(NO_ITEMS.map((item, i) => [item.id, i]));
  });
});
