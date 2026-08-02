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
  route("healthz", "routes/healthz.tsx"),
  route("commonplace", "routes/commonplace.tsx"),
  route("commonplace/:entryId", "routes/commonplace.$entryId.tsx"),
] satisfies RouteConfig;
