/**
 * The `<title>` this app's reading view renders for a work — set by
 * `read.tsx`'s own `meta()`. Reused (not just referenced) by every other
 * route that reports an event while the reader is on that page: the Rig's
 * session routes (`api.v1.rig.tsx`, `api.v1.rig-sessions.tsx`) have no page of their
 * own, they're always a panel over read.tsx, so this is the literal title
 * the browser tab shows for them too — not a guess at what it might be.
 */
export function readPageTitle(workTitle: string): string {
  return `${workTitle} — Reading Rig`;
}
