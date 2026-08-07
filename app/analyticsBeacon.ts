import type { ClientAnalyticsEvent } from "~/analytics.server";

/**
 * Reports a client-only event through `analytics-beacon.tsx`. Fire-and-
 * forget, same as `track()` itself: a dropped beacon is not a reason to
 * interrupt whatever the reader was actually doing (switching sessions,
 * say), so this is never awaited by its callers and any failure is only
 * ever a console warning, not a thrown error.
 *
 * `keepalive: true` so a beacon fired right before a navigation (closing
 * the Rig panel, switching books) still has a chance to land instead of
 * being cancelled with the page that started it — the same guarantee
 * `navigator.sendBeacon` exists for, kept as a plain `fetch` call instead
 * so the request carries a JSON body and this stays consistent with every
 * other client → route call in this codebase (see useRigSessions.ts).
 *
 * `/b`, not `/analytics-beacon` — see routes.ts's own comment on why the
 * path itself is deliberately opaque.
 */
export function sendAnalyticsBeacon(event: ClientAnalyticsEvent): void {
  // `currentUrl` rides alongside the event, not inside it — every call site
  // already has `window.location.href` for free, so this is the one place
  // that grabs it rather than asking each call site to remember to.
  // `analytics-beacon.tsx` splits it back off before trusting the rest as a
  // `ClientAnalyticsEvent`, and `track()` turns it into PostHog's own
  // `$current_url` — see `TrackContext`'s comment in `analytics.server.ts`.
  const body: ClientAnalyticsEvent & { currentUrl: string } = { ...event, currentUrl: window.location.href };
  fetch("/b", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch((error: unknown) => {
    console.warn(`[analytics] beacon for ${event.name} did not land:`, error);
  });
}
