import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
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
  route("healthz", "routes/healthz.tsx"),
  // Same splat convention as read/* and for the same reason — a workId is
  // a slash-shaped slug, so this can't be `read/*/rig` (a single dynamic
  // segment can't sit in the middle of a splat's own match). The Rig's
  // session-lifecycle route (#26): GET opens the stream-first SSE
  // connection, POST sends a message into it.
  route("rig/*", "routes/rig.tsx"),
  route("commonplace", "routes/commonplace.tsx"),
  route("commonplace/:entryId", "routes/commonplace.$entryId.tsx"),
] satisfies RouteConfig;
