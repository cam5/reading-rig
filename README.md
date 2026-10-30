# Reading Rig

A book on the left, and beside it a machine that responds directly to the
passage in front of you. Anything it says can be pushed into the margin,
where it becomes a note. The notes accrue into a commonplace book, which is the
same artefact as the margin seen from the other side.

Personal tool, local SQLite. Every table has carried a `userId` since the first
migration, so accounts arrived as an addition rather than a rewrite: sign-in is
a magic link (`app/routes/auth.login.tsx`, `auth.verify.tsx`, `auth.logout.tsx`,
emailed via `app/email.server.ts`) that sets a signed session cookie
(`app/auth/session.server.ts`). `app/user.server.ts`'s `requireUser()` is still
the one seam anything reaches through to find out who "you" are — it calls
`requireUserId`, which redirects to `/auth/login` when there's no session.

## Getting started

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Locally (anywhere real auth isn't required — see `app/env.server.ts`'s
`requiresRealAuth`) a request with no session falls back to the seeded user, so
you're signed in without doing anything. To exercise the real flow, sign in at
`/auth/login` as the seeded address (`DEV_USER_EMAIL`, default `dev@localhost`);
with no `RESEND_API_KEY` set, the magic link is printed to the dev server's
console instead of emailed.

## Scripts

|                              |                                                                                                                                                                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                | React Router dev server                                                                                                                                                                                                                                                 |
| `npm run typecheck`          | route typegen, then `tsc`                                                                                                                                                                                                                                               |
| `npm test`                   | Vitest over `app/domain`, `app/rig`, `app/auth`, `app/*.server.test.ts` and `lib/**`; the tool-handler tests run against a real SQLite database set up by `app/rig/tools/globalSetupDb.ts`                                                                              |
| `npm run test:watch`         | the same suite in watch mode                                                                                                                                                                                                                                            |
| `npm run test:smoke`         | production build, then `vitest.smoke.config.ts`'s smoke tests against the built server's `/api/v1` routes                                                                                                                                                               |
| `npm run db:generate`        | regenerate the Prisma client into `generated/`                                                                                                                                                                                                                          |
| `npm run db:migrate`         | generate and apply a migration to `dev.db` from schema changes — commit the resulting `prisma/migrations/**` folder alongside the schema change. `prisma db push` still works as an ad-hoc CLI command for quick throwaway prototyping, but isn't the tracked workflow. |
| `npm run db:seed`            | idempotently seed the single local user                                                                                                                                                                                                                                 |
| `npm run db:studio`          | Prisma Studio                                                                                                                                                                                                                                                           |
| `npm run ingest <path.epub>` | parse an EPUB into Work/Chapter/Section/Paragraph and upsert it                                                                                                                                                                                                         |
| `npm run release`            | applies committed migrations (or, on an ephemeral Railway PR environment, resets + reseeds) then seeds/ingests fixtures — run automatically by `npm start` before the server starts, not something you run directly in normal dev                                       |
| `npm run seed:library`       | fetch the pinned public-domain seed books (`scripts/lib/seedLibraryManifest.ts`), ingest them under a library account, and grant them to every existing user — also run by `release.ts`                                                                                 |
| `npm run api-token`          | create, list or revoke a user's `/api/v1` bearer tokens: `npm run api-token -- create <email> [label]` (see `scripts/apiToken.ts`)                                                                                                                                      |
| `npm run agent:setup`        | create or converge the Rig's Managed Agent and its environment (`scripts/setup-agent.ts`) — also run by `release.ts` on deploy when `ANTHROPIC_API_KEY` is set                                                                                                          |
| `npm run generate:openapi`   | write the `/api/v1` OpenAPI document to `openapi/api-v1.json`, so contract changes show up as a diff                                                                                                                                                                    |
| `npm run format`             | Prettier over the repo                                                                                                                                                                                                                                                  |
| `npm run format:check`       | Prettier in check mode, as CI runs it                                                                                                                                                                                                                                   |
| `npm run storybook`          | Storybook dev server                                                                                                                                                                                                                                                    |
| `npm run build-storybook`    | static Storybook build, also what CI and Chromatic build                                                                                                                                                                                                                |

See [MIGRATIONS.md](./MIGRATIONS.md) for the schema-change workflow and
[RUNBOOK.md](./RUNBOOK.md) for triaging a broken deploy.

## Layout

```
app/
  routes/      React Router routes, including auth.* (magic-link sign-in)
  components/  shared components, each with a Storybook story
  domain/      pure logic — locators, ingest, retrieval. No React, no SDK.
  rig/         agent orchestration; tools/ are plain functions over Prisma
  auth/        session cookie, API bearer tokens, rate limiting
lib/           standalone packages — paged-columns, with its own README
scripts/       release, ingest, seed library, agent setup, font build steps
prisma/        schema + migrations
openapi/       the generated /api/v1 spec (npm run generate:openapi)
ios/           the native app — see ios/README.md
design/        the imported Claude Design canvas, and Organic
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
