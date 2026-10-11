# Schema evolution report

Analysis of `prisma/schema.prisma` and its 12 committed migrations, as of
`98ab6df` (2026-10-11). Analysis only: no schema change, no new migration,
and no database was written to produce this. Every check that needed a
database ran against a throwaway SQLite file outside the repo; the root
`dev.db` was only ever opened read-only (row counts and invariants), and its
checksum was confirmed unchanged afterwards.

See [MIGRATIONS.md](../MIGRATIONS.md) for the workflow this is measured
against and [RUNBOOK.md](../RUNBOOK.md) for recovery.

## Summary

- **No drift.** The 12 migrations reproduce `schema.prisma` exactly.
- **The history is safe as it stands today**, but two of the twelve
  migrations (`add_paragraph_word_count`, `add_magic_link_auth`) first
  shipped in a form that failed against populated production tables and were
  corrected in place. Both were the same mistake: a required column with no
  backfill.
- **A failed migration locks out every later deploy until a human
  intervenes.** SQLite migrations are not transactional under Prisma: a
  mid-script failure leaves the earlier statements applied, and every retry
  then stops at `P3009` — including a retry that ships a corrected
  migration. Reproduced on a throwaway database (see
  [Release path](#release-path)). Neither doc mentioned the
  `migrate resolve --rolled-back` step this needs; `MIGRATIONS.md` now does.
- **Nothing snapshots the database before `migrate deploy`.** With
  non-transactional DDL and table-rewrite migrations, a file copy before
  migrating is the only rollback there is.
- **Re-ingesting a work after a parser change that shifts ordinals will
  fail** on `@@unique([sectionId, ordinal])`, because `persistWork` updates
  ordinals one row at a time. This is how content "backfills" for
  `add_footnote`, `add_work_cover_image` and the `kind`/`isBlockquote`
  columns would have to reach existing production works.
- **Deleting a `Work` or a `User` cascades through every reader's notes and
  highlights on it.** Nothing in `app/` deletes anything today, so this is
  latent — but it should be decided before a "remove book" or "delete
  account" feature is built, not discovered by one.
- Hot-path queries are index-backed at current scale. Three indexes are
  redundant, one is unused, and a few foreign keys have no covering index.

## Drift check

| Check                                                                                               | Result                                      |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `prisma validate` (7.9.1)                                                                           | valid                                       |
| `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script` | `-- This is an empty migration.`            |
| Same, `--exit-code` (the form CI runs)                                                              | `No difference detected.`                   |
| All 12 `migration.sql` files replayed in order through `sqlite3` into an empty file                 | no errors                                   |
| `PRAGMA foreign_key_check` / `integrity_check` on the replayed database                             | clean / `ok`                                |
| `prisma migrate deploy` of the 12 migrations into an empty file                                     | all applied                                 |
| Local `dev.db` `_prisma_migrations` (read-only)                                                     | all 12 applied; see out-of-order note below |

Two things the drift check cannot see:

- **Out-of-order history.** `20260811013131_add_magic_link_auth` was
  committed on 2026-08-17, after the `0813` and `0816` migrations had
  already been applied. `migrate deploy` applies any pending migration
  regardless of where its timestamp sorts, so long-lived databases ran these
  in a different order from the one a fresh database replays. It was
  harmless here (the migrations touch unrelated tables), but neither CI's
  `migrate diff` nor `migrate deploy` flags it. A migration that sorts
  before an already-merged one and touches the same table would replay
  differently on a fresh database than it ran in production.
- **Enums.** On SQLite, Prisma enums are plain `TEXT` columns with no
  `CHECK` constraint (confirmed in the replayed DDL: `"role" TEXT NOT NULL`,
  `"kind" TEXT NOT NULL DEFAULT 'prose'`). Adding, renaming or removing a
  value of `ParagraphKind`, `HighlightRole` or `EntryOrigin` is expected to
  generate little or no SQL, so the database will not reject stale values;
  rows holding a removed value fail when the client reads them. Renaming or
  removing an enum value therefore needs a hand-written `UPDATE` in the
  migration.

## Per-migration risk

"Rewrite" means Prisma's `RedefineTables` pattern: create `new_X`, copy
every row, drop `X`, rename, recreate indexes, with `foreign_keys` off.

| #   | Migration                                  | Class                                                     | Rewrite     | Safe against populated prod?     | Notes                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------ | --------------------------------------------------------- | ----------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `baseline`                                 | Baseline (9 tables)                                       | –           | n/a                              | Marked applied via `migrate resolve`, never executed on existing databases. Still declares `Entry.posture`, dropped by #2.                                                                                                                                                                                                  |
| 2   | `drop_posture`                             | **Destructive** column drop                               | `Entry`     | Yes, but irreversible            | A contract step with no preceding expand: the column and its data go in the same deploy that stops reading it, so the previous deployment cannot be rolled back to. Acceptable for a nullable column nothing depended on.                                                                                                   |
| 3   | `add_paragraph_word_count`                 | Required column, no default, **with backfill**            | `Paragraph` | **No as first shipped**; yes now | The `wordCount` incident. Corrected in place: the copy computes the value from `text`. Should have been expand/contract.                                                                                                                                                                                                    |
| 4   | `add_rig_session`                          | Additive (new table)                                      | –           | Yes                              |                                                                                                                                                                                                                                                                                                                             |
| 5   | `allow_multiple_rig_sessions`              | Constraint relaxation (drop unique, add index)            | –           | Yes forward                      | Two plain index statements, no rewrite. One-way in practice: once a (user, work) has two sessions the unique index cannot be restored without deciding which rows to delete.                                                                                                                                                |
| 6   | `add_rig_provisioning`                     | Additive (new table)                                      | –           | Yes                              |                                                                                                                                                                                                                                                                                                                             |
| 7   | `add_magic_link_auth`                      | New table + required **unique** column, **with backfill** | `User`      | **No as first shipped**; yes now | Same failure as #3. Corrected in place with a synthesized `legacy-<id>@reading-rig.invalid` address and `IF NOT EXISTS` / `DROP … IF EXISTS` guards so a retry resumes from the half-applied state. Mixing a new table and a rewrite in one file is what created that half-applied state. Committed out of timestamp order. |
| 8   | `add_paragraph_blockquote_and_scene_break` | Two `NOT NULL` columns **with defaults**                  | `Paragraph` | Yes                              | Defaults make it safe, but it rewrites the largest table. Existing rows are all `prose` / not-blockquote until re-ingested.                                                                                                                                                                                                 |
| 9   | `add_footnote`                             | Additive (new table)                                      | –           | Yes                              | Existing works have no footnote rows until re-ingested.                                                                                                                                                                                                                                                                     |
| 10  | `add_work_cover_image`                     | Additive (two nullable `ADD COLUMN`)                      | –           | Yes                              | The cheapest shape there is. Existing works have no cover until re-ingested.                                                                                                                                                                                                                                                |
| 11  | `add_work_grant`                           | New table + `NOT NULL DEFAULT false` column               | `Work`      | Yes                              | The rewrite copies every cover BLOB. Grants themselves are created by `seedLibrary.ts` / `auth.verify.tsx`, not the migration.                                                                                                                                                                                              |
| 12  | `add_api_token`                            | Additive (new table)                                      | –           | Yes                              |                                                                                                                                                                                                                                                                                                                             |

Observations across the set:

- **Five of twelve migrations rewrite a table**, two of them `Paragraph`.
  At 4,499 local paragraphs this is instant; it grows linearly with the
  library, runs inside the container that is about to serve traffic, and is
  the kind of migration that leaves `new_Paragraph` behind if it fails
  partway.
- **The "say whether a backfill is needed" rule is not being followed.**
  `MIGRATIONS.md` step 3 has asked since 2026-08-03 for a `-- No backfill:`
  comment on every migration that does not need one. Of the eight
  migrations written after that date, only `add_magic_link_auth` says
  anything about backfill. Nothing enforces the rule, and it is the only
  guard against the failure that has already happened twice.
- **Three migrations have a content backfill that SQL cannot do**
  (#8, #9, #10): the new columns and table are only populated by
  re-ingesting the source EPUB. `release.ts` never re-ingests in production
  and the workflow has no step for it. See finding 3.

## Release path

`scripts/release.ts` with `railway.toml`:

- **Production runs `prisma migrate deploy`**, never `reset` or `db push`
  (`scripts/release.ts:60-66`). Confirmed.
- **The reset branch is guarded by a deny-list.** `migrate reset --force`
  runs whenever `RAILWAY_ENVIRONMENT_NAME` is set and is not exactly
  `"production"` (`scripts/release.ts:41-49`). It cannot fire in production
  as long as that environment keeps that exact name. Renaming it, or adding
  a second environment that holds real data, makes the reset branch apply
  to it silently. The actual Railway environment name could not be checked
  from here. See recommendation R2.
- **A failed migration is not rolled back.** Reproduced by appending a
  deliberately failing migration (create table, insert, duplicate insert,
  create second table) to a copy of the history and deploying to a throwaway
  database:
  - First deploy: `P3018`. The first table and its row persisted; the
    second table was never created. `_prisma_migrations` recorded the
    migration as started and unfinished.
  - Second deploy, unchanged: `P3009` — "migrate found failed migrations in
    the target database, new migrations will not be applied."

  In production this means: the container exits non-zero
  (`scripts/release.ts:103-106`), Railway's three retries each hit `P3009`,
  the previous deployment keeps serving (the healthcheck gate works as
  designed), **and merging a corrected migration does not help** until
  someone runs `prisma migrate resolve --rolled-back <name>` against the
  volume. The corrected migration must also tolerate whatever the failed
  attempt left behind, which is what the `IF NOT EXISTS` guards in
  `add_magic_link_auth` are for.

- **The previous deployment keeps serving against a half-migrated
  database.** The healthcheck gate protects traffic from the new code, not
  the old code from the new schema. A rewrite migration that fails after
  `DROP TABLE "X"` but before the rename leaves the old deployment with no
  table at all. This is the strongest argument for keeping every migration
  backward-compatible with the previous release (expand/contract) and for
  R1.
- **No snapshot is taken before migrating.** `RUNBOOK.md` asks for one
  before a manual write, but the automated path — the one that runs
  unattended on every merge — has none.
- **`P3005` self-heal** matches on the string `"P3005"` in captured output
  and resolves the earliest migration as applied
  (`scripts/release.ts:101-114`). It assumes the target matches the
  baseline schema exactly. A database restored from a raw file copy taken
  at a later schema, without its `_prisma_migrations` table, would be
  baselined and then fail on migration #2 or later with partial state. Rare,
  and documented as needing a human.
- **`/healthz` does not touch the database** (`app/routes/healthz.tsx`).
  Fine as a gate, because the server only starts listening after
  `release.ts` exits zero; it does not detect a database that breaks after
  boot.

## Current-schema findings

Ranked by severity. Row counts are from the local `dev.db`; production
figures were not available.

### High

**1. Cascade deletes reach every reader's annotations**
(`prisma/schema.prisma:95`, `:154`, `:166`, `:186`, `:276`, `:317`)

Every relation from `User` and from the content tree is `onDelete: Cascade`.
Deleting a `Work` removes its chapters, sections and paragraphs, and with
them every `HighlightSpan`, `Entry`, `ReadingPosition` and `Footnote`
anchored there — for every user with a grant, not only the owner. Deleting
the `User` who owns a work does the same via `Work.owner`, which includes
the seed-library account and the first uploader of any shared file.

Two side effects of the shape:

- `Highlight` has no path to `Work`, so it survives with zero spans.
- `Entry.highlight` and `Entry.wovenIntoEntry` are `SetNull`, which is
  right, but the entry itself goes via `anchorParagraph`.

No code path in `app/` or `scripts/` calls `delete` or `deleteMany` on any
model, so nothing triggers this today. The commonplace book is the data the
project exists to keep; the schema should make losing it a deliberate act.
See R4.

**2. Re-ingest cannot reorder paragraphs**
(`prisma/schema.prisma:213`, `app/domain/epub/persistWork.server.ts:105-121`)

`Paragraph.id` is a hash of `(workId, spineIndex, elementPath)`, so the same
file re-parsed by a changed parser keeps its ids while `ordinal` and
`globalOrdinal` can shift — which is exactly what introducing `sceneBreak`
rows does. `persistWork` upserts paragraphs one at a time in reading order.
SQLite checks `UNIQUE(sectionId, ordinal)` per statement, so moving a
paragraph to an ordinal its neighbour still holds fails, and the whole
transaction rolls back. (By inspection; not executed here.) Related gaps in
the same function:

- The paragraph `update` branch never sets `sectionId`, and the chapter and
  section branches never set their parent, so a row cannot move between
  parents.
- Rows the parser no longer emits are never removed and keep their old
  ordinals, where they can collide with or interleave among current rows.
- `globalOrdinal` has no uniqueness at all (finding 4), so stale rows would
  silently duplicate positions rather than fail.

The idempotent-upsert assumption in `AGENTS.md` therefore holds for
re-ingesting identical bytes with an identical parser — the case
`seed.ts`, `ingest.ts` and `seedLibrary.ts` exercise on ephemeral
environments, which reset first — and not for the case that matters in
production. See R3.

### Medium

**3. Content backfills have no path to production.** Covered above:
migrations #8, #9 and #10 depend on re-ingest, production never re-ingests,
and finding 2 means a re-ingest may fail. Worth a line in `MIGRATIONS.md`
once R3 is decided.

**4. `Paragraph` has no `workId`** (`prisma/schema.prisma:183-215`)

`globalOrdinal` is unique per work by convention only; the database cannot
enforce it because the work is three joins away. No duplicates exist
locally. The same distance shapes every hot query: the content window,
`getSurrounding`, `searchShelf`, mention search and the structural
whole-work load all filter `section → chapter → workId` and order by
`globalOrdinal`. An approximation of that SQL plans as index lookups down
the tree followed by a temp B-tree sort over the whole work's paragraphs,
for every window fetch. That is fine at thousands of rows per work. See R6
for when it stops being fine.

**5. Unused and write-only columns**

| Column                                                     | State                                                                                                                                                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Entry.rigSessionId` (`:326`)                              | Never written. Read only by the API response schema (`app/domain/api/schemas/paragraph.server.ts:39`). No foreign key, although `RigSession` now exists — the schema comment saying it does not is stale. |
| `Entry.wovenIntoEntryId` / `wovenEntries` (`:330-332`)     | Never written; same single read site.                                                                                                                                                                     |
| `Work.ingestWarnings` (`:117`)                             | Written by `persistWork`, never read.                                                                                                                                                                     |
| `MagicLinkToken` `@@index([email])` (`:47`)                | No query filters by `email`; every lookup is by `tokenHash`.                                                                                                                                              |
| `Highlight` / `Entry` `@@index([userId])` (`:263`, `:337`) | No query filters by `userId`. Keep them: they back the cascade from `User`.                                                                                                                               |

`rigSessionId` and `wovenIntoEntryId` are published in the `/api/v1`
response shape, so removing them is an API change as well as a schema one.

**6. `MagicLinkToken` is never pruned.** Rows are created on every sign-in
request and only ever marked consumed. Unbounded growth, slow at personal
scale. A periodic `deleteMany` on `expiresAt` needs no schema change.

### Low

**7. Redundant indexes.** `Chapter @@index([workId])` (`:160`),
`Section @@index([chapterId])` (`:172`) and `Paragraph @@index([sectionId])`
(`:214`) are each a prefix of the `@@unique` beside them, and the planner
already picks the unique index for a parent-id lookup. They cost a second
B-tree write per row at ingest and per row in every `Paragraph` rewrite.
`WorkGrant @@index([workId])` and `HighlightSpan @@index([paragraphId])` are
**not** redundant: in both, the indexed column is the second column of the
unique.

**8. Foreign keys with no covering index.** `ReadingPosition.paragraphId`,
`ReadingPosition.workId`, `RigSession.workId` and `Entry.wovenIntoEntryId`.
Each makes the parent's cascade or set-null a scan of the child table. All
four tables are tiny and nothing deletes parents today.

**9. Already correct.** The plan for this review suspected missing
uniqueness on the token hashes; both `MagicLinkToken.tokenHash` and
`ApiToken.tokenHash` are `@unique`, and every hot lookup by hash, by
`(userId, workId)` on `ReadingPosition`, and by
`(userId, workId, createdAt)` on `RigSession` uses its index. No
`ReadingPosition` row points at a paragraph outside its own `workId`
locally, though nothing in the schema prevents it.

**10. Minor inconsistencies.**

- `Entry.contextSnapshot` is `Json` (declared `JSONB`, stored as text);
  `Work.ingestWarnings` is JSON in a `String?`. Neither is validated on
  read.
- `Highlight` and `Entry` have `createdAt` but no `updatedAt`. Correct while
  both are immutable; adding note editing needs the column, which is a safe
  nullable add.
- `RigSession.anthropicSessionId` is not unique. Intentional given
  `replaceRigSession`, but nothing stops two rows sharing one remote
  session.
- `Footnote` has no uniqueness on `(paragraphId, refId)`; its id embeds
  `refId` per work, which covers it as long as ids stay deterministic.
- One `legacy-…@reading-rig.invalid` user remains locally from migration
  #7. Production presumably has the same; those accounts can never sign in.

## Recommended follow-ups

None of these has been applied. "Single-step" means one migration in one
deploy is safe; "expand/contract" means the three-deploy recipe in
`MIGRATIONS.md`.

| #   | Change                                                                                                                                                                                                                         | Kind                                                    | Why                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | In `release.ts`, copy the SQLite file to a timestamped sibling before `migrate deploy` when there are pending migrations; keep the last one or two.                                                                            | Code only, no migration                                 | The only rollback available for non-transactional DDL. Needs volume headroom for one extra copy.                                                                                                      |
| R2  | Invert the reset guard to an allow-list: reset only when an explicit variable (e.g. `RIG_EPHEMERAL_DB=1`) is set on the PR and staging-qa environments.                                                                        | Code + Railway variables                                | A rename can no longer turn production into a reset target.                                                                                                                                           |
| R3  | Make `persistWork` reorder-safe: within the transaction, park existing ordinals out of range (e.g. negate them) before writing new ones, set parent ids on update, and decide what happens to rows the parser no longer emits. | Code only, no migration                                 | Unblocks content backfills for #8–#10 and any future parser fix.                                                                                                                                      |
| R4  | Change `Entry.anchorParagraph` and `HighlightSpan.paragraph` from `Cascade` to `Restrict`, so deleting content that carries annotations fails loudly.                                                                          | Single-step (rewrites two small tables, no data change) | Makes annotation loss an explicit decision. Do it before any delete feature exists.                                                                                                                   |
| R5  | Drop the three redundant indexes (finding 7) and `MagicLinkToken_email_idx`.                                                                                                                                                   | Single-step (`DROP INDEX` only)                         | Less write work on the largest table. Low value; fold into the next migration that touches them.                                                                                                      |
| R6  | Add `Paragraph.workId` with `@@unique([workId, globalOrdinal])`.                                                                                                                                                               | **Expand/contract**                                     | Enforces the ordinal invariant and turns window queries into one index range scan. Defer until a work or shelf is large enough to measure; requires R3 first so the unique can hold during re-ingest. |
| R7  | Drop `Entry.rigSessionId`, `Entry.wovenIntoEntryId` and `Work.ingestWarnings`, or start using them.                                                                                                                            | **Expand/contract** (contract half)                     | Remove from the API schema and ship first; drop the columns in a later deploy. Rewrites `Entry` and `Work`.                                                                                           |
| R8  | Add CI checks that a new migration (a) sorts after every migration already on `main` and (b) mentions `backfill` in a comment.                                                                                                 | CI only                                                 | Catches the out-of-order case and makes the existing written rule enforceable.                                                                                                                        |
| R9  | Prune expired `MagicLinkToken` rows.                                                                                                                                                                                           | Code only, no migration                                 | Finding 6.                                                                                                                                                                                            |

Suggested order: R1 and R2 first (they reduce the blast radius of every
later migration), then R3, then R4. The rest can wait for a reason.
