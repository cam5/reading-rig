# Postmortem: <short description of what broke>

Write one of these after any incident that took prod (or staging-qa) down,
lost or corrupted data, or needed a manual step from RUNBOOK.md to recover —
once service is back, not during. A shipped bug that was caught in a PR
environment and never reached anyone doesn't need one.

Start from a generated draft rather than this file directly:

```bash
npm run postmortem -- <PR number>               # the fix PR, usually
npm run postmortem -- <commit SHA>
npm run postmortem -- --since 2026-08-17 --until 2026-08-18
npm run postmortem -- <PR number> --stdout      # preview, write nothing
```

That fills in the facts git and gh already know — titles, timestamps,
changed files, linked issues, which commits touched `prisma/migrations/`,
`scripts/release.ts` or `railway.toml` — and leaves every judgment call as
a `<!-- TODO: -->`. Replace each TODO with what actually happened, citing
logs where you can. If something is unknown, say "unknown" rather than
guessing; a postmortem that invents a detail is worse than one with a gap.

Blameless: describe what the system allowed and what the checks missed,
not who typed what. "The migration passed CI because CI migrates an empty
database" is useful; "X forgot a backfill" isn't.

**Status:** draft | reviewed

**Category:** Build failure | Release/migration failure | Runtime/config
failure | Client (iOS/macOS) failure — see RUNBOOK.md's classification.

## Summary

Two or three sentences: what broke, for how long, how it was fixed.

## Impact

Who and what was affected (prod, staging-qa, PR environments, the iOS
app), how (502s, crash loop, data loss, degraded), and for how long.

## Timeline (UTC)

| When (UTC) | Event |
| ---------- | ----- |
|            |       |

Include what git can't see: the first failing deploy, when it was noticed,
when mitigation started, when recovery was verified.

## Detection

How it was noticed — healthcheck, a 502 in the browser, a user, CI — and
how long after the trigger.

## Root cause

Why it broke, in terms of systems rather than people. Include why the
existing checks (CI, PR environments, staging-qa, MIGRATIONS.md's review
step) didn't catch it.

## Trigger

The specific change or event that set it off. Often not the same thing as
the root cause.

## Resolution and recovery

What restored service — which RUNBOOK.md steps were used — and how
recovery was verified.

## What went well / what went poorly

**Went well**

**Went poorly**

## Action items

| Action | Owner | Issue | Status |
| ------ | ----- | ----- | ------ |
|        |       |       |        |

Prefer changes to systems (a check, a doc, a default) over "be more
careful". Each one gets an issue.

## Related PRs, commits and issues

- [RUNBOOK.md](../../RUNBOOK.md), [MIGRATIONS.md](../../MIGRATIONS.md)
