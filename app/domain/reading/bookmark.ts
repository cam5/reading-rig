/**
 * Invariant 3: "nothing past your bookmark" — enforced as a WHERE clause,
 * not a prompt instruction. This is the one place the comparison is
 * written; a future retrieval query (the Rig's tools, M3) inherits the
 * boundary by using it, rather than re-deriving `<=` in a dozen places
 * and eventually getting one of them wrong.
 */
export function isWithinBookmark(paragraphGlobalOrdinal: number, bookmarkGlobalOrdinal: number): boolean {
  return paragraphGlobalOrdinal <= bookmarkGlobalOrdinal;
}

/** The equivalent Prisma WHERE fragment, for a real query — e.g.
 * `db.paragraph.findMany({ where: { ...bookmarkWhereClause(pos), ... } })`. */
export function bookmarkWhereClause(bookmarkGlobalOrdinal: number) {
  return { globalOrdinal: { lte: bookmarkGlobalOrdinal } };
}
