/**
 * The context set for one turn — "what's in view" when a question is about
 * to be asked through the lens. Built client-side (read.tsx): there's
 * nothing upstream of a session that persists a context set independently,
 * so this is a plain value the reader assembles for the turn in hand, not
 * a record with its own table.
 *
 * `passageLabel` is always present — a turn is always asked from somewhere,
 * even the unnarrowed "ask through the lens" box, whose passage is the
 * whole visible section (read.tsx derives that with formatLocatorRange
 * over the section's loaded paragraphs). `items` is what "+ add" widens:
 * today's page entries (hand or Rig) the reader has explicitly pulled in,
 * beyond the passage itself.
 */
export type ContextSetItem = {
  /** An Entry's id — "+ add" only ever widens with entries already on the
   * page today; there's no separate source/upload concept until M4. */
  id: string;
  /** Already-formatted for the chip and the sentence, e.g. "your note,
   * 12 Mar" or "your Interrogate entry, 12 Mar" — built where the entry's
   * own posture/date are known (read.tsx), not re-derived here. */
  label: string;
};

export type ContextSet = {
  passageLabel: string;
  items: ContextSetItem[];
};

/**
 * What a Rig entry's `contextSnapshot` actually holds — the schema
 * comment's "richer context (which passages and prior entries were in
 * view)", plus the rendered statement itself. The statement is stored
 * verbatim, not just its ingredients, for the same reason the schema
 * comment gives for capturing everything else at write time: the exact
 * sentence the reader saw before asking "cannot be truthfully
 * reconstructed later from anything else" if this function's wording ever
 * changes.
 */
export type RigContextSnapshot = ContextSet & { statement: string };

/** Oxford-and join: "a", "a and b", "a, b, and c". */
function joinWithAnd(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * Invariant 3, stated in the UI rather than left implicit in the query:
 * a plain-sentence account of what's in view for the turn about to be
 * asked, always naming what is *not* in view too — "nothing past your
 * bookmark". Quiet and literary, per the build plan's copy invariant: no
 * exclamation, no emoji, no product cheer.
 *
 * The bookmark clause is unconditional, not computed from anything passed
 * in here — every one of the Rig's retrieval tools is bookmark-bounded by
 * construction (app/domain/reading/bookmark.ts), so it is always true, and
 * this function's whole job is to say so plainly rather than let it go
 * unstated.
 */
export function contextStatement(contextSet: ContextSet): string {
  const parts = [`this passage (${contextSet.passageLabel})`, ...contextSet.items.map((item) => item.label)];
  return `In view: ${joinWithAnd(parts)}. Nothing past your bookmark.`;
}
