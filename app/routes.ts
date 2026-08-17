import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("auth/login", "routes/auth.login.tsx"),
  route("auth/verify", "routes/auth.verify.tsx"),
  route("auth/logout", "routes/auth.logout.tsx"),
  // A splat, not :workId — Work ids are slash-shaped slugs
  // (deriveWorkId, "karl-marx/capital-volume-i"), mirroring Standard
  // Ebooks' own multi-segment URL convention. A single dynamic segment
  // can't match that; params["*"] captures everything after "read/".
  route("read/*", "routes/read.tsx"),
  // Loader-only: the client-side content-window fetch (useContentWindow)
  // hits this as the reader scrolls near the edge of what's loaded. Can't
  // nest under "read/*" — a splat has to be the trailing segment, and
  // read/* already swallows everything after "read/".
  route("read-content", "routes/read-content.tsx"),
  // Loader-only, same reasoning as read-content above: the composer's "@"
  // autocomplete (useMentionCandidates) hits this on every keystroke.
  route("mention-suggestions", "routes/mention-suggestions.tsx"),
  // Splat, same reasoning as read/* — see cover.tsx's own comment.
  route("cover/*", "routes/cover.tsx"),
  route("healthz", "routes/healthz.tsx"),
  // Same splat convention as read/* and for the same reason — a workId is
  // a slash-shaped slug, so this can't be `read/*/rig` (a single dynamic
  // segment can't sit in the middle of a splat's own match). The Rig's
  // session-lifecycle route (#26): GET opens the stream-first SSE
  // connection, POST sends a message into it.
  route("rig/*", "routes/rig.tsx"),
  // The session picker's data source: list/create as plain JSON, since
  // rig/*'s own GET always returns text/event-stream. Same splat reasoning
  // as rig/* itself.
  route("rig-sessions/*", "routes/rig-sessions.tsx"),
  route("commonplace", "routes/commonplace.tsx"),
  route("commonplace/:entryId", "routes/commonplace.$entryId.tsx"),
  // Action-only: the one route a browser calls track() through directly,
  // for client-only events with no other request to hang off. See
  // ClientAnalyticsEventName in app/analytics.server.ts. Path is
  // deliberately opaque ("b", not "analytics" or "beacon") — those words
  // are exactly what ad-/tracker-blocklists (EasyPrivacy and friends)
  // pattern-match on, and this beacon reports lengths and counts a reader
  // already chose to do in this app, not third-party tracking.
  route("b", "routes/analytics-beacon.tsx"),
] satisfies RouteConfig;
