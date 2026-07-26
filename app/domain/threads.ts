/**
 * The next ThreadEntry.ordinal for a thread, given the ordinals already
 * in it. Assigned by the application, not DB-enforced-unique — a
 * single-user tool has no concurrent-writer race to guard against here.
 */
export function nextThreadOrdinal(existingOrdinals: number[]): number {
  return existingOrdinals.length === 0 ? 0 : Math.max(...existingOrdinals) + 1;
}
