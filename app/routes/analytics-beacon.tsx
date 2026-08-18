import {
  track,
  type ClientAnalyticsEvent,
  type ClientAnalyticsEventName,
} from "~/analytics.server";
import { requireUser } from "~/user.server";
import type { Route } from "./+types/analytics-beacon";

/**
 * The one route a browser is trusted to call `track()` through directly —
 * for events with no request of their own to hang off, the way
 * `RigSessionMenu`'s `onSelect` is client-side state and nothing else (see
 * `rig_session_switched`'s doc comment in `app/analytics.server.ts`).
 * Everything else in the catalog reports itself from inside the route
 * handler that already did the work; this is only for the genuine
 * exceptions, gated to `ClientAnalyticsEventName` so a modified client
 * can't forge an event outside that short list.
 *
 * Fire-and-forget from the caller's side (`app/analyticsBeacon.ts`) —
 * same "never worth failing the real action over" posture `track()`
 * itself already has, just one hop earlier.
 */

const CLIENT_EVENT_NAMES: ClientAnalyticsEventName[] = [
  "rig_session_switched",
  "section_navigated",
  "rig_opened",
];

function isClientEventName(name: unknown): name is ClientAnalyticsEventName {
  return (
    typeof name === "string" && (CLIENT_EVENT_NAMES as string[]).includes(name)
  );
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const body: unknown = await request.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("name" in body) ||
    !isClientEventName(body.name)
  ) {
    throw new Response("Unknown or missing event name", { status: 400 });
  }

  // `currentUrl`/`screenName` are transport plumbing `sendAnalyticsBeacon`
  // adds (`app/analyticsBeacon.ts`), not part of the event itself — split
  // off before the rest is trusted as a ClientAnalyticsEvent, same posture
  // as `name` above.
  const { currentUrl, screenName, ...event } = body as {
    currentUrl?: unknown;
    screenName?: unknown;
  };

  // Trusted only as far as CLIENT_EVENT_NAMES reaches: body's shape beyond
  // `name` is whatever the caller sent, not re-validated field by field —
  // the same posture the rest of the catalog takes with values that
  // originate in a request (e.g. read.tsx's `spans`), and low-stakes here
  // since every ClientAnalyticsEvent is already a count/flag, never text.
  await track(event as ClientAnalyticsEvent, {
    distinctId: user.id,
    currentUrl: typeof currentUrl === "string" ? currentUrl : undefined,
    screenName: typeof screenName === "string" ? screenName : undefined,
  });
  return { ok: true };
}
