/**
 * Pure derivations for `/commonplace` (3a) — the When rail's buckets, the
 * hand/rig provenance counts, and splitting an anchor paragraph's text
 * around the excerpt an entry was saved against, for "the margin it came
 * from". No React, no Prisma — the route loader supplies real rows, these
 * just shape them.
 */

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Monday of the calendar week containing `date`, at local midnight. */
function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0 (Sun) .. 6 (Sat)
  const diffToMonday = (day + 6) % 7;
  d.setDate(d.getDate() - diffToMonday);
  return d;
}

export type WhenEntry = { createdAt: Date };
export type WhenBucket = { label: string; count: number; current: boolean };

/**
 * Buckets entries into "This week" plus one bucket per calendar month
 * before it, most recent first — the design's When rail ("This week 7",
 * "April 19", "March 34"). A bucket only appears if it has entries; the
 * year is appended to the label when it isn't `now`'s year, since a bare
 * month name would otherwise be ambiguous across a year boundary.
 */
export function bucketEntriesByWhen(
  entries: WhenEntry[],
  now: Date,
): WhenBucket[] {
  const weekStart = startOfWeek(now);
  let thisWeekCount = 0;
  const monthCounts = new Map<
    string,
    { label: string; count: number; sortKey: number }
  >();

  for (const entry of entries) {
    if (entry.createdAt >= weekStart) {
      thisWeekCount += 1;
      continue;
    }
    const year = entry.createdAt.getFullYear();
    const month = entry.createdAt.getMonth();
    const key = `${year}-${month}`;
    const label =
      year === now.getFullYear()
        ? MONTH_NAMES[month]
        : `${MONTH_NAMES[month]} ${year}`;
    const existing = monthCounts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      monthCounts.set(key, { label, count: 1, sortKey: year * 12 + month });
    }
  }

  const monthBuckets = Array.from(monthCounts.values())
    .sort((a, b) => b.sortKey - a.sortKey)
    .map(({ label, count }): WhenBucket => ({ label, count, current: false }));

  const buckets: WhenBucket[] = [];
  if (thisWeekCount > 0)
    buckets.push({ label: "This week", count: thisWeekCount, current: true });
  buckets.push(...monthBuckets);
  return buckets;
}

export type ProvenanceCounts = { hand: number; rig: number };

/** "your hand · N" / "kept from the Rig · N" — a straight tally of
 * `Entry.origin` across whatever set of entries it's given (the whole
 * shelf, for 3a). */
export function provenanceCounts(
  entries: { origin: "hand" | "rig" }[],
): ProvenanceCounts {
  let hand = 0;
  let rig = 0;
  for (const entry of entries) {
    if (entry.origin === "hand") hand += 1;
    else rig += 1;
  }
  return { hand, rig };
}

export type MarginContext = { before: string; match: string; after: string };

/**
 * Splits a paragraph's text around the excerpt an entry was saved
 * against, so the right rail can render the surrounding sentence dimmed
 * and the excerpt itself in full contrast — 3a's "the margin it came
 * from". Falls back to the whole paragraph as `match` when there's no
 * excerpt, or the excerpt isn't a literal substring (contextSnapshot is
 * free-form JSON; a future write path isn't guaranteed to keep the
 * property this reads).
 */
export function splitAroundExcerpt(
  text: string,
  excerpt: string | undefined,
): MarginContext {
  const index = excerpt ? text.indexOf(excerpt) : -1;
  if (!excerpt || index === -1) {
    return { before: "", match: text, after: "" };
  }
  return {
    before: text.slice(0, index),
    match: text.slice(index, index + excerpt.length),
    after: text.slice(index + excerpt.length),
  };
}
