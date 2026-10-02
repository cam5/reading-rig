# Reading Rig

A book on the left, and beside it a machine that responds directly to the
passage in front of you. Anything it says can be pushed into the margin,
where it becomes a note. The notes accrue into a commonplace book, which is the
same artefact as the margin seen from the other side.

A personal tool that has since grown accounts. Every table carried a `userId`
from the first migration, so they arrived as an addition rather than a rewrite.
You sign in with a magic link: a single-use link, good for fifteen minutes, sent
through Resend — or printed to the console when `RESEND_API_KEY` is unset, so
the whole flow can be walked from a terminal. A signed session cookie carries
who you are from there. Each reader sees the works they own or have been
granted, and only their own highlights, notes and bookmarks. A client that is
not a browser — the iOS app in `ios/` — presents a bearer token instead of a
cookie.

`app/user.server.ts` is still the one seam anything reaches through to find out
who "you" are: `requireUser()` for the pages, which sends a stranger to
`/auth/login`, and `requireApiUser()` for `/api/v1/*`, which answers with a JSON
401 instead. Outside production and staging, a request with no session falls
back to the seeded user, so `npm run dev` asks nothing of you. Storage is one
SQLite file.

## Getting started

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

The shelf starts empty. `npm run ingest <path.epub>` adds a book — there are
fixtures under `app/domain/epub/__fixtures__/` — and `npm run seed:library`
fetches the seed library.

To walk the real sign-in locally, open `/auth/login`; without a Resend key the
link appears in the dev server's output.

## Configuration

[`.env.example`](./.env.example) is the source of truth for environment
variables, and says what each one is for. Only `DATABASE_URL` is needed locally;
everything else — the Anthropic key for the Rig, the session secret, Resend,
PostHog — is optional, and each feature goes quiet without its key.

## Scripts

|                               |                                                                                                                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                 | React Router dev server                                                                                                                                                                                                                                                 |
| `npm run build`               | production build, into `build/`                                                                                                                                                                                                                                         |
| `npm start`                   | `npm run release`, then serve the built app with `react-router-serve` — what a deploy runs                                                                                                                                                                              |
| `npm run typecheck`           | route typegen, then `tsc`                                                                                                                                                                                                                                               |
| `npm run format`              | Prettier over the whole repo; `npm run format:check` only reports, and is what CI runs                                                                                                                                                                                  |
| `npm test`                    | Vitest over `app/domain/**`, `app/rig/**`, `app/auth/**`, `app/*.server.test.ts` and `lib/**` — plain functions, no browser. `npm run test:watch` is the same in watch mode. See [docs/TESTING.md](./docs/TESTING.md).                                                  |
| `npm run test:smoke`          | builds, then sends real requests through the built server's `/api/v1` routes                                                                                                                                                                                            |
| `npm run generate:openapi`    | rewrite `openapi/api-v1.json` from the `/api/v1` zod schemas — run it, and commit the result, when one changes. See [docs/API.md](./docs/API.md).                                                                                                                       |
| `npm run db:generate`         | regenerate the Prisma client into `generated/`                                                                                                                                                                                                                          |
| `npm run db:migrate`          | generate and apply a migration to `dev.db` from schema changes — commit the resulting `prisma/migrations/**` folder alongside the schema change. `prisma db push` still works as an ad-hoc CLI command for quick throwaway prototyping, but isn't the tracked workflow. |
| `npm run db:seed`             | idempotently seed the local user — the one a request with no session falls back to in dev                                                                                                                                                                               |
| `npm run db:studio`           | Prisma Studio                                                                                                                                                                                                                                                           |
| `npm run ingest <path.epub>`  | parse an EPUB into Work/Chapter/Section/Paragraph and upsert it, owned by the oldest account                                                                                                                                                                            |
| `npm run seed:library`        | fetch the pinned Standard Ebooks editions in `scripts/lib/seedLibraryManifest.ts`, ingest them under a library account, and grant them to every user. Needs the network.                                                                                                |
| `npm run api-token <command>` | bearer tokens for non-browser clients: `create <email> [label]` prints a token once, `list <email>`, `revoke <email> <tokenId>`                                                                                                                                         |
| `npm run agent:setup`         | create the Rig's Managed Agent and environment, or converge them onto the current config. Needs `ANTHROPIC_API_KEY`.                                                                                                                                                    |
| `npm run release`             | applies committed migrations (or, on an ephemeral Railway PR environment, resets + reseeds) then seeds/ingests fixtures — run automatically by `npm start` before the server starts, not something you run directly in normal dev                                       |
| `npm run storybook`           | Storybook dev server                                                                                                                                                                                                                                                    |
| `npm run build-storybook`     | static Storybook build, also what CI and Chromatic build                                                                                                                                                                                                                |

Three things run without being asked. `postinstall` generates the Prisma client
and installs the git hooks in `scripts/git-hooks/`. `predev` and `prebuild` (and
their Storybook equivalents) subset Caprasimo and instance Fraunces into
`public/fonts/generated/`, which is gitignored and rebuilt each time.

See [MIGRATIONS.md](./MIGRATIONS.md) for the schema-change workflow and
[RUNBOOK.md](./RUNBOOK.md) for triaging a broken deploy.

## Layout

```
app/
  routes/         React Router routes — pages, auth.*, and the api.v1.* JSON surface
  components/     shared components, each with a Storybook story
  domain/         pure logic — locators, ingest, retrieval. No React, no SDK.
    api/          zod schemas for /api/v1, and the OpenAPI document built from them
  auth/           session cookie, bearer API tokens, rate limiting
  rig/            agent orchestration; tools/ are plain functions over Prisma
  styles/         organic.css — the design tokens — and font faces
lib/
  paged-columns/  standalone pagination over CSS multi-column layout
scripts/          what the npm scripts run; git-hooks/ holds the hook sources
prisma/           schema + migrations + seed
openapi/          api-v1.json, generated; the iOS client is built from it
ios/              the Swift client — outside the Node build entirely
assets/fonts/     the committed Caprasimo source the subsetting script reads
design/           the imported Claude Design canvas, and Organic
docs/             the API and testing guides
.github/workflows/  CI, Chromatic, Lighthouse, iOS tests, the staging-qa deploy
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

## Further reading

- [docs/API.md](./docs/API.md) — the `/api/v1` JSON surface: auth, errors, each
  route, and keeping the OpenAPI file current.
- [docs/TESTING.md](./docs/TESTING.md) — what each test command covers, the CI
  workflows, and the git hooks.
- [MIGRATIONS.md](./MIGRATIONS.md) — shipping a schema change.
- [RUNBOOK.md](./RUNBOOK.md) — triaging and recovering a broken deploy.
- [SECURITY.md](./SECURITY.md) — a living list of areas worth revisiting.
- [AGENTS.md](./AGENTS.md) — for agents working in a git worktree of this repo.
- [GLOSSARY.md](./GLOSSARY.md) — the vocabulary.
- [app/rig/tools/README.md](./app/rig/tools/README.md) — the agent's read-only
  tool handlers, and the bookmark boundary.
- [lib/paged-columns/README.md](./lib/paged-columns/README.md) — how the paged
  reading mode measures pages.
- [ios/README.md](./ios/README.md) — the iOS client.

## Design

The source canvas is in `design/Reading Rig.dc.html` — open it in a browser.
Screens are referenced by the IDs it uses: the reader is **1c**, skill
invocation is **2b** and **2c**, the commonplace book is **3a** and **3b**.
`design/_ds/organic-*/` is the Organic design system those screens are built on.
