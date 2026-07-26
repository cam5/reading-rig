import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  // A splat, not :workId — Work ids are slash-shaped slugs
  // (deriveWorkId, "karl-marx/capital-volume-i"), mirroring Standard
  // Ebooks' own multi-segment URL convention. A single dynamic segment
  // can't match that; params["*"] captures everything after "read/".
  route("read/*", "routes/read.tsx"),
  route("healthz", "routes/healthz.tsx"),
  route("commonplace", "routes/commonplace.tsx"),
] satisfies RouteConfig;
