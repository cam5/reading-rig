# Testing, CI and git hooks

What each command covers, what runs on a pull request, and what the hooks do
on your machine. The reasoning behind each choice is in the config files'
own comments; this is the map.

## `npm test`

Vitest, in a Node environment, over:

- `app/domain/**/*.test.ts`
- `app/rig/**/*.test.ts`
- `app/auth/**/*.test.ts`
- `app/*.server.test.ts`
- `lib/**/*.test.ts`

`npm run test:watch` is the same set in watch mode.

The list is narrow on purpose (`vitest.config.ts`). These are the layers held
to being plain functions: no React, no request context, network calls kept
thin and pushed out to `scripts/` or route glue. That is what keeps the suite
fast and free of a browser. Two things are deliberately left out:

- **Route tests.** They get their own config — the smoke suite below — instead
  of widening this one.
- **Storybook's Vitest addon**, which would have `npm test` download and drive
  a real Chromium.

`vitest.config.ts` is separate from `vite.config.ts` so that the React Router
plugin is not loaded for a run of plain-function tests.

### A real SQLite database

The tool-handler tests in `app/rig/tools/`, and the other tests that query
through Prisma, run against a real database, not a mock. Two files make that
cheap:

- `app/rig/tools/globalSetupDb.ts` runs once per `vitest run`. It deletes any
  template left by a previous run, then runs
  `prisma db push --accept-data-loss` with `DATABASE_URL` pointed at a
  template file in the OS temp directory (`reading-rig-vitest-template.db`).
- `app/rig/tools/testDb.ts`'s `createTestDb()` copies that template into a
  fresh temp directory and returns a `PrismaClient` for it. Each test file
  gets its own copy, so there are no shared rows and no lock contention
  between workers. The caller disconnects the client when done.

The schema push only ever targets the template. It does not read or touch
`dev.db`, whatever your `.env` says.

## `npm run test:smoke`

`npm run build`, then `vitest run --config vitest.smoke.config.ts`, which
includes `app/routes/*.smoke.test.ts` — today, `apiV1.smoke.test.ts`.

The suite imports the built server (`build/server/index.js`) and dispatches
real `Request`s through React Router's `createRequestHandler`: real routing,
real auth, real JSON serialisation, no port and no server process. It seeds
its own copy of the template database before the build is loaded.

It is a smoke test, not a contract test. It checks status codes and a few
top-level keys on each `/api/v1` route — enough to catch a mistyped route
registration or an export dropped in a merge. It also proves a bearer token
selects its own user, and that an invalid one is not trusted. Response shapes
are the zod schemas' job; see [API.md](./API.md).

`/api/v1/rig/*` is excluded: it opens a real Anthropic session, which needs a
key and network access that CI does not have.

The build is not part of the suite's own setup, so when you are iterating on
the test file alone you can skip it:

```bash
npx vitest run --config vitest.smoke.config.ts
```

That needs a `build/` from an earlier `npm run build`, and will test whatever
is in it.

## Other local checks

| Command                   | What it checks                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run typecheck`       | route typegen, then `tsc`                                                                      |
| `npm run format:check`    | Prettier, over everything not in `.prettierignore`                                             |
| `npm run build-storybook` | that every story still builds                                                                  |
| `npx lhci autorun`        | the Lighthouse budgets — see the header of `lighthouserc.cjs` for the bootstrap it needs first |

Visual regression is Chromatic's, and is described in the
[README](../README.md#visual-regression-testing).

## CI

Five workflows in `.github/workflows/`. All use Node 24 except `ios.yml`,
which uses the runner's Xcode. All but the deploy cancel an in-progress run
for the same ref when a new one starts.

| Workflow         | Runs on                                                                                     | What it does                                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`         | every pull request; push to `main`                                                          | In order: `npm ci`, `format:check`, `db:generate`, a `prisma migrate diff` that fails if `schema.prisma` has changes no committed migration captures, `typecheck`, `npm test`, `test:smoke`, `build-storybook`.                                                                           |
| `chromatic.yml`  | every pull request; push to `main`                                                          | Publishes Storybook to Chromatic for visual diffing. The publish step is skipped while the `CHROMATIC_PROJECT_TOKEN` secret is absent.                                                                                                                                                    |
| `lighthouse.yml` | every pull request; push to `main`                                                          | Builds, applies migrations, seeds the user, ingests both fixture EPUBs, then `lhci autorun` against the budgets in `lighthouserc.cjs`. On a pull request it also fetches the base branch's latest reports and posts a comparison as a sticky comment. Uploads the reports as an artifact. |
| `ios.yml`        | pull requests and pushes to `main` that touch `ios/**`, `openapi/**` or the workflow itself | `swift test` in `ios/`, on `macos-latest`.                                                                                                                                                                                                                                                |
| `deploy-qa.yml`  | manual dispatch only                                                                        | Not a check. Deploys the chosen branch to the `staging-qa` Railway environment with `railway up`. Needs the `RAILWAY_TOKEN` secret.                                                                                                                                                       |

To run what `ci.yml` runs before pushing:

```bash
npm run format:check
npm run typecheck
npm test
npm run test:smoke
npm run build-storybook
```

The migration check is the one step with no npm script. It only matters if you
have edited `prisma/schema.prisma`; see [MIGRATIONS.md](../MIGRATIONS.md).

## Git hooks

Git does not version hooks, so their sources are checked in under
`scripts/git-hooks/` and installed by `scripts/install-git-hooks.ts`, which
`postinstall` runs after every `npm install`.

The installer symlinks each hook into the repository's common git directory,
falling back to a copy where symlinks are unavailable. Three things follow
from that:

- Editing a hook's source takes effect at once, with no reinstall.
- The hooks directory is shared by every worktree of the repo, so installing
  from any one of them installs for all.
- An existing `pre-commit` or `post-commit` in `.git/hooks` is replaced.

Where there is no `.git` — a deploy build — the installer does nothing.

### `pre-commit`

Runs `prettier --write --ignore-unknown` over the staged files that were
added, copied or modified, then re-stages them. Formatting is therefore fixed
at commit time, not merely reported.

- If Prettier is not installed yet, the hook exits quietly and lets the commit
  through.
- If a file is only partly staged, the whole working-tree file is reformatted
  and re-added, which pulls the unstaged hunks into the commit.

CI's `format:check` is the backstop for a commit made with `--no-verify`, or
from a checkout whose hooks are stale.

### `post-commit`

A reminder, never a gate: it always exits 0. If the commit touched
`app/styles/organic.css`, it runs `check-token-diff.mjs` over the previous
commit and the new one. That script parses the `@theme` block on each side and
prints every design token added, removed or changed, with a note to update the
matching Figma variables. A commit that did not touch the file, or has no
parent, prints nothing.

`check-token-diff.mjs` is the hook's helper, not a hook itself. It is a pure
parse-and-diff with no model call.
