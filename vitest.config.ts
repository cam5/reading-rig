import { defineConfig } from "vitest/config";

// A separate config from vite.config.ts on purpose: that one loads the React
// Router plugin, which has no business in a run of pure domain tests.
//
// The `include` is narrow by design. `app/domain/**` is the layer the plan
// keeps free of React and of the Anthropic SDK, so it is the layer that can be
// tested as plain functions. Component and route tests, when they arrive, get
// their own project entry rather than widening this one.
export default defineConfig({
  test: {
    include: ["app/domain/**/*.test.ts"],
    environment: "node",
  },
});
