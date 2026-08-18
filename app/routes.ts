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
  // Splat, same reasoning as read/* — see cover.tsx's own comment.
  route("cover/*", "routes/cover.tsx"),
  route("healthz", "routes/healthz.tsx"),
  route("upload", "routes/upload.tsx"),
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

  // /api/v1/* — plain-JSON routes for a non-browser client (#192): a
  // native app can't use RR8's single-fetch turbo-stream wire format the
  // page routes above return on `.data` requests, and shouldn't have to
  // reach into web-only routes for data. Auth here is requireApiUser
  // (JSON 401), not requireUser (redirect to /auth/login) — see
  // user.server.ts. Versioned from day one per #192's recommendation:
  // cheap now, expensive to retrofit once a client depends on the shape.
  //
  // Each of these mirrors a page route's own data (or, for the four
  // below that used to be unprefixed sidecars — read-content,
  // mention-suggestions, rig-sessions, rig — is one), sharing the same
  // domain-layer fetch as its page counterpart rather than duplicating
  // the query/shaping logic. See app/domain/work/fetchShelf.server.ts,
  // app/domain/commonplace.server.ts, and
  // app/domain/reading/fetchReadPageData.server.ts.
  route("api/v1/home", "routes/api.v1.home.tsx"),
  route("api/v1/read/*", "routes/api.v1.read.tsx"),
  route("api/v1/commonplace", "routes/api.v1.commonplace.tsx"),
  route(
    "api/v1/commonplace/:entryId",
    "routes/api.v1.commonplace.$entryId.tsx",
  ),
  // Loader-only: the client-side content-window fetch (useContentWindow)
  // hits this as the reader scrolls near the edge of what's loaded. Can't
  // nest under api/v1/read/* — a splat has to be the trailing segment,
  // and that route's own splat already swallows everything after it.
  route("api/v1/read-content", "routes/api.v1.read-content.tsx"),
  // Loader-only, same reasoning as read-content above: the composer's "@"
  // autocomplete (useMentionCandidates) hits this on every keystroke.
  route("api/v1/mention-suggestions", "routes/api.v1.mention-suggestions.tsx"),
  // Splat, same reasoning as read/* — a workId is a slash-shaped slug, so
  // this can't be `api/v1/read/*/rig` (a single dynamic segment can't sit
  // in the middle of a splat's own match). The Rig's session-lifecycle
  // route (#26): GET opens the stream-first SSE connection, POST sends a
  // message into it.
  route("api/v1/rig/*", "routes/api.v1.rig.tsx"),
  // The session picker's data source: list/create as plain JSON, since
  // api/v1/rig/*'s own GET always returns text/event-stream. Same splat
  // reasoning as that route itself.
  route("api/v1/rig-sessions/*", "routes/api.v1.rig-sessions.tsx"),
] satisfies RouteConfig;
