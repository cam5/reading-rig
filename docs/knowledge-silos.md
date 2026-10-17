# Knowledge silos

Who knows what in this repo, according to its git history. Regenerate the
section below the line with `npm run knowledge-silo` (see
[README.md](../README.md#scripts) for flags). It reads `git log` on the
current branch only, so work sitting on unmerged branches isn't counted.

## Reading this report

This is a one-human repo. Once `.mailmap` folds together the three aliases
(`Cameron`, `Cameron Hurd`, and the `artofenso.com` address), every non-merge
commit on `main` comes from one person. So **every area is a bus-factor-1
silo by definition**, and every row's flags are identical. That tells you
nothing new. What is useful is **the ranking**: which sole-owned areas are
largest, change most often, and have the least written down. Those are the
areas a second contributor (or the same person after six months away) would
struggle with first.

Bots and coding agents (`posthog[bot]`, `Claude <noreply@anthropic.com>`) are
classified separately and never count as knowledge holders. Today they only
appear on unmerged branches, so they don't show up below.

### Where written knowledge transfer already exists

| Area                      | Rank | Written docs                                                                                                 | Gap                                                                                                                                      |
| ------------------------- | ---: | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `app/domain`              |    1 | [GLOSSARY.md](../GLOSSARY.md) (text tree, locators, highlights); [SECURITY.md](../SECURITY.md) (EPUB ingest) | No overview of the locator / `globalOrdinal` model or of `reading/`, `typography/` and `paragraph/`, the largest area by churn           |
| `app/components`          |    2 | Storybook stories, one per component                                                                         | Mostly self-documenting through stories, so lower risk than its rank suggests                                                            |
| `app/routes`              |    3 | none                                                                                                         | Loader/action conventions and the optimistic-save / `shouldRevalidate` behaviour aren't written down outside code comments and PRs       |
| `app/rig`                 |    4 | [app/rig/tools/README.md](../app/rig/tools/README.md); [SECURITY.md](../SECURITY.md) (tool surface)          | The tools are covered. **Provisioning, session loop and convergence** (`rigProvisioning.ts`, `sessionLoop.ts`, `*Convergence.ts`) aren't |
| `ios/Sources`, `ios`      | 5,12 | [ios/README.md](../ios/README.md) (layout, auth, XcodeGen, local dev loop)                                   | Reasonably well covered                                                                                                                  |
| `scripts`                 |    8 | Header comments in each script; [RUNBOOK.md](../RUNBOOK.md) (Railway)                                        | `release.ts` (the reset-vs-migrate choice on PR environments) and `setup-agent.ts` have no prose doc                                     |
| `prisma`                  |   10 | [MIGRATIONS.md](../MIGRATIONS.md); doc comments in `schema.prisma`                                           | Well covered                                                                                                                             |
| `.github/workflows`       |   13 | [README.md](../README.md) (Chromatic only)                                                                   | The Lighthouse CI and other workflows aren't described                                                                                   |
| Worktree / `.env` hygiene |    — | [AGENTS.md](../AGENTS.md)                                                                                    | Covered                                                                                                                                  |

### Recommended mitigations

1. **Write `app/rig/README.md`** covering the rig's lifecycle: how
   `ensureRigProvisioning` converges the Managed Agent + Environment, why
   the ids live in the `RigProvisioning` table rather than `.env` (#113), the
   request-time self-heal path, and how the staging environment's wake/reset
   interacts with it. This is the highest-churn area with the thinnest
   design-level docs, and the one whose failures are hardest to diagnose.
2. **Add a "Release and PR environments" section to RUNBOOK.md** that
   explains what `scripts/release.ts` does on each kind of environment
   (migrate vs reset + reseed, when `setup-agent` runs). It's executed on
   every deploy and today only its own comments explain it.
3. **Add an `app/domain/README.md`** that sketches the locator model and the
   bookmark boundary (`WHERE globalOrdinal <= …`). It should link GLOSSARY.md
   for terms rather than repeat them. This is the largest area and the one
   everything else depends on.
4. **Document the route conventions** (optimistic saves, revalidation, where
   analytics events fire), either in a short `app/routes/README.md` or
   alongside the existing README "Layout" section.
5. **Get a second reviewer into the loop early.** Once a second human
   contributor appears, this report becomes a real ownership map rather
   than a ranking. Re-run it then. Areas still at 100% after a few months
   are where pairing or deliberate hand-off should go first.

---

<!-- Generated by `npm run knowledge-silo`. Everything below is overwritten on regeneration. -->

## Contributors

174 non-merge commits.

- Cameron Hurd <me@cameronhurd.com> — 174 commits

## Silos, ranked

Flagged when an area has one human author, a top author at or above 80% of churn, or a bus factor of 1. Ranked by churn × top-author share. "Stale" means sole-owned and untouched for over 180 days. "Recent share" decays each commit with a 180-day half-life; "freshness" is how much of an area's churn survives that decay.

|   # | Area                | Commits | Churn | Humans | Bus factor | Top author   | Share | Recent share | Freshness | Last change | Docs in area | Flags                                   |
| --: | ------------------- | ------: | ----: | -----: | ---------: | ------------ | ----: | -----------: | --------: | ----------- | ------------ | --------------------------------------- |
|   1 | `app/domain`        |      55 | 10783 |      1 |          1 | Cameron Hurd |  100% |         100% |       76% | 2026-08-19  | —            | sole-author, concentrated, bus-factor-1 |
|   2 | `app/components`    |      77 | 10212 |      1 |          1 | Cameron Hurd |  100% |         100% |       77% | 2026-08-26  | —            | sole-author, concentrated, bus-factor-1 |
|   3 | `app/routes`        |      76 |  9007 |      1 |          1 | Cameron Hurd |  100% |         100% |       77% | 2026-08-26  | —            | sole-author, concentrated, bus-factor-1 |
|   4 | `app/rig`           |      27 |  7995 |      1 |          1 | Cameron Hurd |  100% |         100% |       76% | 2026-08-19  | yes          | sole-author, concentrated, bus-factor-1 |
|   5 | `ios/Sources`       |      11 |  1953 |      1 |          1 | Cameron Hurd |  100% |         100% |       80% | 2026-08-19  | yes          | sole-author, concentrated, bus-factor-1 |
|   6 | `app/styles`        |      15 |  1883 |      1 |          1 | Cameron Hurd |  100% |         100% |       76% | 2026-08-18  | —            | sole-author, concentrated, bus-factor-1 |
|   7 | `app`               |      29 |  1856 |      1 |          1 | Cameron Hurd |  100% |         100% |       77% | 2026-08-19  | —            | sole-author, concentrated, bus-factor-1 |
|   8 | `scripts`           |      32 |  1788 |      1 |          1 | Cameron Hurd |  100% |         100% |       76% | 2026-08-19  | —            | sole-author, concentrated, bus-factor-1 |
|   9 | `(root files)`      |      52 |  1722 |      1 |          1 | Cameron Hurd |  100% |         100% |       75% | 2026-08-26  | —            | sole-author, concentrated, bus-factor-1 |
|  10 | `prisma`            |      24 |   690 |      1 |          1 | Cameron Hurd |  100% |         100% |       75% | 2026-08-19  | —            | sole-author, concentrated, bus-factor-1 |
|  11 | `app/auth`          |       4 |   599 |      1 |          1 | Cameron Hurd |  100% |         100% |       79% | 2026-08-19  | —            | sole-author, concentrated, bus-factor-1 |
|  12 | `ios`               |       8 |   412 |      1 |          1 | Cameron Hurd |  100% |         100% |       80% | 2026-08-19  | yes          | sole-author, concentrated, bus-factor-1 |
|  13 | `.github/workflows` |      15 |   336 |      1 |          1 | Cameron Hurd |  100% |         100% |       75% | 2026-08-19  | —            | sole-author, concentrated, bus-factor-1 |
|  14 | `.storybook`        |       7 |   190 |      1 |          1 | Cameron Hurd |  100% |         100% |       74% | 2026-08-13  | —            | sole-author, concentrated, bus-factor-1 |
|  15 | `scripts/lib`       |       3 |   179 |      1 |          1 | Cameron Hurd |  100% |         100% |       79% | 2026-08-19  | —            | sole-author, concentrated, bus-factor-1 |
