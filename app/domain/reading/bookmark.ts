/**
 * Invariant 3: "nothing past your bookmark" — enforced as a WHERE clause,
 * not a prompt instruction. This is the one place the comparison is
 * written; a retrieval query the Rig runs on its own (search_shelf,
 * getPassage, getSurrounding) inherits the boundary by using it, rather
 * than re-deriving `<=` in a dozen places and eventually getting one of
 * them wrong.
 *
 * Deliberately NOT used by the composer's "@"-mention search
 * (searchMentionCandidates) or its pinned on-screen excerpt — see that
 * file's own comment. This invariant is about the Rig surfacing an
 * unrequested spoiler in its own retrieval; a mention is the reader
 * pointing at something already on their own screen.
 */
export function isWithinBookmark(paragraphGlobalOrdinal: number, bookmarkGlobalOrdinal: number): boolean {
  return paragraphGlobalOrdinal <= bookmarkGlobalOrdinal;
}

/** The equivalent Prisma WHERE fragment, for a real query — e.g.
 * `db.paragraph.findMany({ where: { ...bookmarkWhereClause(pos), ... } })`. */
export function bookmarkWhereClause(bookmarkGlobalOrdinal: number) {
  return { globalOrdinal: { lte: bookmarkGlobalOrdinal } };
}
