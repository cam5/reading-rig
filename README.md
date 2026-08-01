# Reading Rig

A book on the left, and beside it a machine you invoke as a *posture* rather than
a chat — Interrogate, Steelman, Connect, Close-read, Context, Recap — held over
the passage in front of you. Anything it says can be pushed into the margin,
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

| | |
|---|---|
| `npm run dev` | React Router dev server |
| `npm run typecheck` | route typegen, then `tsc` |
| `npm test` | Vitest over `app/domain/**` |
| `npm run db:generate` | regenerate the Prisma client into `generated/` |
| `npm run db:migrate` | generate and apply a migration to `dev.db` from schema changes — commit the resulting `prisma/migrations/**` folder alongside the schema change. `prisma db push` still works as an ad-hoc CLI command for quick throwaway prototyping, but isn't the tracked workflow. |
| `npm run db:seed` | idempotently seed the single local user |
| `npm run db:studio` | Prisma Studio |
| `npm run ingest <path.epub>` | parse an EPUB into Work/Chapter/Section/Paragraph and upsert it |
| `npm run release` | applies committed migrations (or, on an ephemeral Railway PR environment, resets + reseeds) then seeds/ingests fixtures — run automatically by `npm start` before the server starts, not something you run directly in normal dev |
| `npm run storybook` | Storybook dev server |
| `npm run build-storybook` | static Storybook build, also what CI and Chromatic build |

See [MIGRATIONS.md](./MIGRATIONS.md) for the schema-change workflow and
[RUNBOOK.md](./RUNBOOK.md) for triaging a broken deploy.

## Layout

```
app/
  routes/      React Router routes
  components/  shared components, each with a Storybook story
  domain/      pure logic — locators, ingest, retrieval. No React, no SDK.
  rig/         agent orchestration; tools/ are plain functions over Prisma
prisma/        schema + migrations
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
   includes what it is *not* looking at — "nothing past your bookmark".
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

Terms like *marginalia*, *locator*, *hand*/*rig*, and *posture* have a
specific meaning in this codebase — see [GLOSSARY.md](./GLOSSARY.md).

## Design

The source canvas is in `design/Reading Rig.dc.html` — open it in a browser.
Screens are referenced by the IDs it uses: the reader is **1c**, skill
invocation is **2b** and **2c**, the commonplace book is **3a** and **3b**.
`design/_ds/organic-*/` is the Organic design system those screens are built on.
