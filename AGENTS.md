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
