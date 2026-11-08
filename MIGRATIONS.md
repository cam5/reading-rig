# Shipping a schema change

How schema changes reach prod, and why. See [RUNBOOK.md](./RUNBOOK.md) for
what to do when a deploy breaks anyway.

## The workflow

1. Edit `prisma/schema.prisma`.
2. `npm run db:migrate -- --name <short-description>` — generates
   `prisma/migrations/<timestamp>_<description>/migration.sql` and applies
   it to your local `dev.db`.
3. **Read the generated `migration.sql` before committing it.** This is the
   review step that was missing when `prisma db push` computed and applied
   an unreviewed diff on every boot — the incident this file exists because
   of. If the SQL isn't what you expect, fix the schema and regenerate
   rather than hand-editing the migration.
   - **Explicitly consider whether existing prod rows need a backfill**, and
     say so in the migration file. If one's needed, write it in (see
     expand/contract below). If it truly isn't — a new table, a nullable
     column, an empty-in-prod table — add a one-line comment saying why,
     e.g. `-- No backfill: <Table> has no rows in prod yet.` A required
     column added with no backfill and no comment is exactly what shipped
     the `wordCount` incident (RUNBOOK.md): it passed everywhere (CI, PR
     environments, local `dev.db`) because every one of those resets to an
     empty table before migrating, and only failed against prod's real
     rows. Empty-elsewhere is not evidence of empty-in-prod; say so in
     writing instead of relying on it being obvious in the moment.
4. Commit `prisma/schema.prisma` and the new `prisma/migrations/**` folder
   together, in the same PR. CI (`migrate diff --exit-code`) fails the
   build if they drift apart — a backstop, not a substitute for reading the
   SQL yourself.
5. On merge, prod applies it via `prisma migrate deploy`, run by `npm start`
   (`scripts/release.ts`) before the server starts listening — Railway's
   `preDeployCommand` can't do this, since pre-deploy commands run in a
   separate container with no volume access (confirmed against a live PR
   environment). If it fails, the container never starts listening,
   `/healthz` never returns 200, and Railway keeps the previous deployment
   serving until either that happens or `railway.toml`'s capped retries run
   out — see RUNBOOK.md if that happens.

`prisma db push` still works as an ad-hoc CLI command for quick local
prototyping (a schema you're still iterating on, not ready to commit), but
it's not part of this workflow and nothing runs it automatically anymore.

## When a change needs expand/contract instead of one migration

Rule of thumb: **any new required column or table on a table that _might_
have existing rows in prod** — not gated on today's row count, since "empty
today" isn't a safety property. (This is exactly how the incident happened:
a required column added to tables that were non-empty in prod.)

Recipe — three independently-revertable deploys instead of one that can't
be undone once applied:

1. Migration adds the column **nullable** (or the table, with no required
   columns yet referencing existing rows). Ship.
2. Backfill — a one-off script, or a follow-up migration with a data
   statement. Ship.
3. Migration adds the `NOT NULL` constraint (SQLite: this rewrites the
   table — see the `RedefineTables` pattern Prisma already generates for
   this). Ship.

If a change doesn't touch a table that could have real rows (a new table
with no data yet, a genuinely additive nullable column), a single migration
is fine — the expand/contract recipe is for the case that broke prod, not a
blanket rule for every migration.

## API backward compatibility

The database isn't the only contract that outlives a deploy. The iOS app
(`ios/Sources/ReadingRigKit`) generates its Swift types at build time from
`openapi/api-v1.json` (via a symlink), and API-token agents call the same
routes. A build already on someone's phone keeps the contract it was built
with, forever. So **changes to `/api/v1` must be additive.**

"Additive" is stricter here than for most JSON clients, because of what
swift-openapi-generator actually generates (checked against its output in
`ios/.build`):

- **Adding a response property is breaking** when the object is declared
  `additionalProperties: false`, and every `z.object()` response in this API
  is. The generated decoder calls `ensureNoAdditionalProperties` and throws
  on any key it doesn't know.
- **Adding a value to a response enum is breaking.** Generated string enums
  are `@frozen`, so an unknown value fails to decode.
- Still safe: new paths, new methods, new response status codes, new
  optional request parameters or body fields, new request enum values or
  `oneOf` variants, a new alternative in `security`, and responses that get
  _stricter_ (nullable to non-null, optional to required, fewer enum values).
  `findBreakingChanges` in `app/domain/api/openapiCompat.server.ts` has the
  full list. Its tests document each case.

Two checks enforce this in CI:

1. `app/domain/api/openapi.server.test.ts` (under `npm test`) fails if the
   committed `openapi/api-v1.json` doesn't match what
   `buildOpenApiDocument()` generates from the routes' zod schemas. Fix it
   with `npm run generate:openapi`, and commit the result alongside the
   route change.
2. `npm run api:compat` (pull requests only) compares the PR's
   `openapi/api-v1.json` with the base branch's and lists every breaking
   change. To run it locally: `BASE_REF=main npm run api:compat`.

When you need a breaking change, use the same expand/contract recipe as the
database:

1. Expand: add the new field or route next to the old one. Ship.
2. Migrate the clients: release an iOS build that uses the new shape, and
   wait until the old builds are gone.
3. Contract: remove the old field or route.

For a reshape too big for that, add it under `/api/v2` instead.

**Override:** if a break is intentional and you've accounted for every
client (for example, the field was never read by any shipped build), add
this trailer to any commit in the PR:

```
API-Breaking-Change: <why this is safe>
```

The reason must be non-empty. With the trailer, `api:compat` prints the
findings as warnings and passes. It's an audit record in `git log`, not a
way to skip the check. Write the reason for the person who has to figure out
later why an old app build broke.

## Baselining

Prisma Migrate needs to be told that tables which already exist are already
covered by the first migration, rather than trying to replay `CREATE TABLE`
against a database that already has those tables.

`scripts/release.ts` now does this automatically: if `prisma migrate deploy`
fails with `P3005` (schema not empty, no `_prisma_migrations` row), it
resolves the earliest migration as applied and retries, once, before giving
up. This exists because that step was run against local `dev.db` when this
repo baselined off `db push` but never against the real prod volume — prod
then failed P3005 on every boot until this self-heal shipped (the
`prisma migrate resolve` invocation below is what it runs). The manual form
is still here for anything the automatic path doesn't cover — a target
database with genuine drift, not just a missing baseline row, will fail
differently (not `P3005`) and needs a human to look at it, per
[RUNBOOK.md](./RUNBOOK.md):

```bash
# Generate the migration SQL by diffing from an empty schema — this only
# reads prisma/schema.prisma, it does not touch a live database.
mkdir -p prisma/migrations/<timestamp>_baseline
npx prisma migrate diff \
  --from-empty \
  --to-schema prisma/schema.prisma \
  --script > prisma/migrations/<timestamp>_baseline/migration.sql

# Mark it applied without running it — this only writes to the
# _prisma_migrations bookkeeping table, never touches schema or data.
npx prisma migrate resolve --applied <timestamp>_baseline

# Confirm.
npx prisma migrate status
```

This only needs to happen again if `_prisma_migrations` on a given database
(prod, or a fresh contributor's `dev.db` seeded from a raw copy rather than
via migrations) is missing or out of sync — normal contributor setup
(`npm run db:migrate`) never needs this.
