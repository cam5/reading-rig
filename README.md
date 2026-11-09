# Reading Rig

A book on the left, and beside it a machine that responds directly to the
passage in front of you. Anything it says can be pushed into the margin,
where it becomes a note. The notes accrue into a commonplace book, which is the
same artefact as the margin seen from the other side.

Personal tool. Single user, local SQLite, no accounts — but every table carries
a `userId` from the first migration, so accounts are an addition rather than a
rewrite. `app/user.server.ts`'s `requireUser()` is the one seam anything reaches
through to find out who "you" are; when real auth arrives, that function's body
is the only thing that changes.

## Getting started

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

## Scripts

|                                                  |                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                    | React Router dev server                                                                                                                                                                                                                                                 |
| `npm run build`                                  | production build into `build/`                                                                                                                                                                                                                                          |
| `npm start`                                      | runs `npm run release`, then serves the production build with `react-router-serve`                                                                                                                                                                                      |
| `npm run typecheck`                              | route typegen, then `tsc`                                                                                                                                                                                                                                               |
| `npm test`                                       | Vitest over `app/domain/**`, `app/rig/**`, `app/auth/**`, `app/*.server.test.ts` and `lib/**`. A global setup pushes the schema into a real SQLite test database once per run; nothing is mocked at the Prisma layer and no API key is needed                           |
| `npm run test:watch`                             | the same suite, in watch mode                                                                                                                                                                                                                                           |
| `npm run test:smoke`                             | builds, then runs `vitest.smoke.config.ts` — the `app/routes/*.smoke.test.ts` suite, against the built server                                                                                                                                                           |
| `npm run format`                                 | Prettier, writing changes                                                                                                                                                                                                                                               |
| `npm run format:check`                           | Prettier, checking only — what CI runs                                                                                                                                                                                                                                  |
| `npm run generate:openapi`                       | writes `openapi/api-v1.json`, the committed copy of the document `api.v1.openapi` serves live, so a contract change shows up as a diff                                                                                                                                  |
| `npm run db:generate`                            | regenerate the Prisma client into `generated/`                                                                                                                                                                                                                          |
| `npm run db:migrate`                             | generate and apply a migration to `dev.db` from schema changes — commit the resulting `prisma/migrations/**` folder alongside the schema change. `prisma db push` still works as an ad-hoc CLI command for quick throwaway prototyping, but isn't the tracked workflow. |
| `npm run db:seed`                                | idempotently seed the single local user                                                                                                                                                                                                                                 |
| `npm run db:studio`                              | Prisma Studio                                                                                                                                                                                                                                                           |
| `npm run ingest <path.epub>`                     | parse an EPUB into Work/Chapter/Section/Paragraph and upsert it                                                                                                                                                                                                         |
| `npm run seed:library`                           | fetch the pinned seed-library EPUBs (checked against their sha256) and ingest them under a fixed library account                                                                                                                                                        |
| `npm run api-token create\|list\|revoke <email>` | issue, list or revoke a bearer token — the stand-in for a sign-in flow bearer credentials don't yet have                                                                                                                                                                |
| `npm run agent:setup`                            | converge the Rig's Managed Agent and Environment onto `app/rig/agentConfig.ts` / `environmentConfig.ts`, creating them the first time, and record their ids in the `RigProvisioning` table. `npm run release` also runs it when `ANTHROPIC_API_KEY` is set              |
| `npm run release`                                | applies committed migrations (or, on an ephemeral Railway PR environment, resets + reseeds) then seeds/ingests fixtures — run automatically by `npm start` before the server starts, not something you run directly in normal dev                                       |
| `npm run storybook`                              | Storybook dev server                                                                                                                                                                                                                                                    |
| `npm run build-storybook`                        | static Storybook build, also what CI and Chromatic build                                                                                                                                                                                                                |

`dev`, `build`, `storybook` and `build-storybook` each have a `pre` hook that
regenerates the self-hosted fonts into `public/fonts/generated/` — the
Caprasimo subset and the pinned Fraunces instances. `postinstall` runs
`prisma generate` and installs the git hooks in `scripts/git-hooks/`
(Prettier on staged files before a commit; a reminder after one when the
design tokens change).

See [MIGRATIONS.md](./MIGRATIONS.md) for the schema-change workflow and
[RUNBOOK.md](./RUNBOOK.md) for triaging a broken deploy.

## Layout

```
app/
  routes/      React Router routes
  components/  shared components, each with a Storybook story
  domain/      pure logic — locators, ingest, retrieval. No React, no SDK.
  rig/         agent orchestration; tools/ are plain functions over Prisma — see app/rig/README.md
  auth/        session cookie, bearer API tokens, rate limiting
lib/           standalone packages — paged-columns, with its own README
scripts/       CLI entry points behind the npm scripts, and git-hooks/
prisma/        schema + migrations
generated/     Prisma client output — generated, never hand-edited
openapi/       the generated, committed /api/v1 OpenAPI document
ios/           the native app — see ios/README.md
design/        the imported Claude Design canvas, and Organic
.github/workflows/
  ci.yml          format, migration drift, typecheck, unit + smoke tests, Storybook build
  chromatic.yml   Storybook to Chromatic for visual review
  lighthouse.yml  Lighthouse run against the built server, commented on the PR
  ios.yml         swift test, only when ios/ or openapi/ change
  deploy-qa.yml   manual deploy of a chosen branch to staging-qa
```

`app/domain/` is deliberately free of React and of the Anthropic SDK. It is the
layer that can be tested as plain functions, and it is where the locator model
lives — the thing everything else is expressed in terms of.

## The four invariants

Taken from the design brief. These are constraints, not decoration, and every
ticket is checked against them:

1. **Colour is semantic.** Terracotta is the machine's voice and the live thing;
   sage is your hand and your shelf. Nothing else is coloured.
2. **The margin is the only way notes are made.** There is no separate
   note-creation flow, so reading and thinking share one artefact.
3. **Context is stated in plain sentences**, never as a token count, and always
   includes what it is _not_ looking at — "nothing past your bookmark".
4. **Copy is quiet and literary.** No exclamation, no product cheer, no emoji.

The third is enforced as a `WHERE` clause on `globalOrdinal`, not as a prompt
instruction: the agent cannot see past your bookmark because the query never
returns it.

## Visual regression testing

`.github/workflows/chromatic.yml` builds Storybook and publishes it to
[Chromatic](https://www.chromatic.com) on every PR, which diffs each story's
rendered output against the last-accepted baseline and flags visual changes
for review. It authenticates with a `CHROMATIC_PROJECT_TOKEN` repository
secret; until that secret is added, the publish step is skipped rather than
failing CI. See the repo's issues for the one-time manual setup (sign up at
chromatic.com, link this GitHub repo, add the token as a repo secret).

## Glossary

Terms like _marginalia_, _locator_, and _hand_/_rig_ have a specific meaning
in this codebase — see [GLOSSARY.md](./GLOSSARY.md).

## Design

The source canvas is in `design/Reading Rig.dc.html` — open it in a browser.
Screens are referenced by the IDs it uses: the reader is **1c**, skill
invocation is **2b** and **2c**, the commonplace book is **3a** and **3b**.
`design/_ds/organic-*/` is the Organic design system those screens are built on.
