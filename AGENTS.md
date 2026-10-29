# For agents working in a git worktree of this repo

`DATABASE_URL` in `.env` is a _relative_ path (`file:./dev.db`) — this is
what isolates each worktree's SQLite file from the primary checkout's, and
from every other worktree's. That isolation only holds if the worktree
actually has its own `.env`.

Before running `npm run dev`, `npm run release`, or doing any browser-based
verification (Playwright, claude-in-chrome) inside a worktree: confirm
`.env` exists there (`cp .env.example .env` if not). A worktree with no
`.env` risks its dev server resolving against the primary checkout's
`dev.db` instead of its own — real rows (bookmarks, highlights, notes) end
up in the primary directory's database, indistinguishable from a real
user's data and just as durable, since nothing in `prisma migrate deploy` /
`prisma/seed.ts` / `scripts/ingest.ts` ever deletes that data on restart —
they only sync schema and upsert content by deterministic id, by design, so
a real user's progress and notes survive a reseed.

## Git hooks are shared across worktrees

`.git/hooks` lives in the common git dir (`git rev-parse --git-common-dir`),
not per worktree. `postinstall` runs `scripts/install-git-hooks.ts`, which
symlinks `.git/hooks/pre-commit` and `post-commit` to `scripts/git-hooks/` in
_whichever checkout last ran `npm install`_. If that checkout was a worktree
that has since been deleted, every checkout's hooks dangle: the pre-commit
Prettier pass and post-commit reminder are silently skipped, and `npm ci` in a
new worktree can fail at `postinstall`.

Check with `ls -la .git/hooks`. Re-running the installer alone does not fix
it: `existsSync` reports a dangling symlink as absent, so the installer skips
the unlink, `symlinkSync` hits `EEXIST`, and the copy fallback follows the dead
link to `ENOENT`. Remove the dead links first, then reinstall from a checkout
that will outlive any worktree (normally the primary one):

```bash
rm "$(git rev-parse --git-common-dir)"/hooks/{pre-commit,post-commit}
npx tsx scripts/install-git-hooks.ts
```

Until then, don't assume a commit passed through the hooks — confirm with
`git log -1` and `npm run format:check`.

## `npm test` and Prisma's AI-agent guard

`app/rig/tools/globalSetupDb.ts` runs `prisma db push --accept-data-loss`
once per `vitest run`, with `DATABASE_URL` overridden to a throwaway template
in the OS temp dir (`reading-rig-vitest-template.db`). Prisma refuses
`--accept-data-loss` from an AI agent unless
`PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` is set. Setting it is fine for
`npm test` / `npm run test:smoke`, because that push only ever touches the
temp template. It is not consent for any destructive Prisma command against
`dev.db`; the rule above still applies.

## Which `dev.db` is real

The local database is `dev.db` at the repo root. `prisma.config.ts` sits at
the root and passes `DATABASE_URL` (`file:./dev.db`) through unchanged, so it
resolves there. `prisma/dev.db` is a stale, empty leftover — when inspecting
local data (`sqlite3`, `npm run db:studio`), use the root file. Neither is
tracked in git.
