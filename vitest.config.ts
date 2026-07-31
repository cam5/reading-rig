import { defineConfig } from "vitest/config";

// A separate config from vite.config.ts on purpose: that one loads the React
// Router plugin, which has no business in a run of pure domain tests.
//
// The `include` is narrow by design. `app/domain/**` is the layer the plan
// keeps free of React and of the Anthropic SDK, so it is the layer that can be
// tested as plain functions. Component and route tests, when they arrive, get
// their own project entry rather than widening this one.
//
// `app/*.server.test.ts` is the one addition: a top-level `.server` module
// (analytics.server.ts) is neither a component nor a route — it is plain
// functions with no React and no request context, testable on exactly the
// same terms as the domain layer. This is not the door for route tests;
// those still get their own entry.
//
// Storybook has its own test surface (`@storybook/addon-vitest`, a headless
// Chromium via Playwright) that `storybook init` wires in here by default.
// Deliberately not adopted: it turns `npm test` into something that
// downloads and drives a real browser, which is more than #3 asked for and
// changes what "the domain layer tests fast and stays pure" means. Revisit
// if we want real component/story tests later.
export default defineConfig({
  test: {
    include: ["app/domain/**/*.test.ts", "app/*.server.test.ts"],
    environment: "node",
  },
});
