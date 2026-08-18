import { defineConfig } from "vitest/config";

// Separate from vitest.config.ts on purpose — that config's own comment
// already reserves this territory ("route tests, when they arrive, get
// their own project entry"). This is that entry.
//
// Unlike the domain/rig suite (plain functions, no build needed), this
// one hits the actual built server (`build/server/index.js`, from `npm
// run build`) through React Router's own createRequestHandler — real
// routing, real auth wrapper, real JSON serialization, no HTTP port. It's
// a smoke test, not a contract test: it proves the /api/v1 routes are
// actually wired (right file, right verb, auth attached) rather than
// validating every field a response can carry — that's the OpenAPI/zod
// layer's job (#194), once it exists.
//
// Requires `npm run build` to have run first — deliberately not run here
// as part of setup, since that would make every `test:smoke` invocation
// pay for a full production build even when iterating on the test file
// itself. `npm run test:smoke` chains the two.
export default defineConfig({
  test: {
    include: ["app/routes/*.smoke.test.ts"],
    environment: "node",
    // Same shared-template mechanism vitest.config.ts uses (see
    // globalSetupDb.ts) — reused directly rather than duplicated, since
    // running `vitest run --config vitest.smoke.config.ts` on its own
    // (e.g. via `npm run test:smoke`) can't assume the other config's
    // globalSetup already ran in this process.
    globalSetup: ["./app/rig/tools/globalSetupDb.ts"],
    // The smoke suite talks to a real build + real SQLite file per test
    // case set up in beforeAll — no reason to parallelize workers for a
    // handful of requests, and it keeps output easy to read top-to-bottom
    // when something fails.
    fileParallelism: false,
  },
});
