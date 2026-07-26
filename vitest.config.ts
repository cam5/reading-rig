import { defineConfig } from "vitest/config";

// A separate config from vite.config.ts on purpose: that one loads the React
// Router plugin, which has no business in a run of pure domain tests.
//
// The `include` is narrow by design. `app/domain/**` is the layer the plan
// keeps free of React and of the Anthropic SDK, so it is the layer that can be
// tested as plain functions. Component and route tests, when they arrive, get
// their own project entry rather than widening this one.
//
// `app/rig/**` joined the include in M3: it's where the build plan puts
// SDK-adjacent code (agent config, postures, tool handlers) — not domain,
// since it does touch `@anthropic-ai/sdk` types, but still held to the same
// bar of pure/testable functions with the actual network calls kept thin and
// pushed out to `scripts/` or route glue.
//
// Storybook has its own test surface (`@storybook/addon-vitest`, a headless
// Chromium via Playwright) that `storybook init` wires in here by default.
// Deliberately not adopted: it turns `npm test` into something that
// downloads and drives a real browser, which is more than #3 asked for and
// changes what "the domain layer tests fast and stays pure" means. Revisit
// if we want real component/story tests later.
export default defineConfig({
  test: {
    include: ["app/domain/**/*.test.ts", "app/rig/**/*.test.ts"],
    environment: "node",
    // #25's tool-handler tests run against a real SQLite database (no API
    // key involved, so no reason to mock Prisma) rather than a fake one —
    // globalSetupDb.ts pushes the schema once per `vitest run`, and each
    // test file gets its own copy of the result (see tools/testDb.ts).
    globalSetup: ["./app/rig/tools/globalSetupDb.ts"],
  },
});
