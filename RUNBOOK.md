# Triaging and recovering a broken deploy

See [MIGRATIONS.md](./MIGRATIONS.md) for how schema changes are supposed to
ship. This is what to do when a deploy breaks anyway.

## Railway settings reference

Committed as code in [`railway.toml`](./railway.toml):

- **No `deploy.preDeployCommand`.** Railway's pre-deploy commands run in a
  separate container with no volume access at all, in any environment —
  confirmed by watching it happen live on a PR environment:
  `preDeployCommand` ran migrate/seed/ingest successfully, but none of it
  landed on the volume actually mounted into the real runtime container,
  which then came up with an empty database and 500'd on every route.
  (PR environments' volumes are already meant to be treated as disposable —
  see `scripts/release.ts`'s ephemeral branch — but that's a separate,
  repo-specific choice from this: preDeployCommand can't reach a mounted
  volume at all, which would break prod's actually-persistent one the same
  way.) Migrations against the SQLite volume have to run inside the
  container that has it mounted — i.e. as part of `npm start`
  (`scripts/release.ts` runs first, then execs into the server).
- `deploy.healthcheckPath = "/healthz"` — Railway keeps the _previous_
  deployment serving traffic until this returns 200 on the new one. A
  container stuck failing its release step (or crashing on boot for any
  other reason) never receives real traffic.
- `deploy.restartPolicyMaxRetries = 3` — caps retries on a genuine runtime
  crash so a bad deploy fails fast (a handful of tries) instead of the
  original incident's 10 retries over ~4 minutes.

Dashboard edits to these fields should be followed by re-syncing
`railway.toml` so the file stays the source of truth.

## Health snapshot → logs → classify

1. `railway status` — which environment/service, current deployment state.
2. `railway deployment list` — is the latest deploy `SUCCESS`, `CRASHED`,
   or stuck retrying?
3. `railway logs` (or `--deployment <id>` for a specific one) — read the
   actual failure. Classify:
   - **Build failure** — fails before the container ever starts. Check the
     build log, not the deploy/runtime log.
   - **Release/migration failure** — `npm start` runs `npm run release`
     (`scripts/release.ts`) first; if it exits non-zero, the server never
     starts, `/healthz` never returns 200, and the previous deployment keeps
     serving while `railway.toml`'s capped retries run out. Check whether
     it's a genuinely unsafe migration (needs expand/contract, see
     MIGRATIONS.md) vs. something else.
   - **Runtime/config failure** — release succeeded, the server itself
     won't stay up (missing env var, crash after boot). Same symptoms as
     above from the outside (previous deployment keeps serving); the
     difference only shows up in the logs.

## Getting a shell on a crash-looping or otherwise stuck service

1. Register an SSH key with Railway if you haven't (`railway ssh` will
   prompt, or see the Railway CLI docs) — one-time setup.
2. Override the start command to keep the container alive without running
   the app: `railway environment edit --json` (or the equivalent flag on
   whatever the current CLI calls it) with a JSON patch setting
   `deploy.startCommand` to `sleep infinity`. **Use the JSON-patch form,
   not a dot-path (`--service-config deploy.startCommand=...`) —** the
   dot-path form no-op'd for this field in practice during the original
   incident.
3. Redeploy so the override takes effect, then `railway ssh` in.
4. Fix the problem from inside the container (e.g., hand-run the specific
   migration/backfill statement against the live db file).
5. Restore `deploy.startCommand` to the real command explicitly — setting
   it to `null` didn't clear it back to the Nixpacks-detected default in
   practice; set it back to the actual start command (`npm start`, or
   whatever's in `railway.toml`/dashboard) rather than unsetting it.
6. Redeploy again with the restored start command.

Reviewed migrations (MIGRATIONS.md) make this less likely to be needed for
migration failures specifically — but since release still runs inside the
boot path (unavoidable, given Railway's pre-deploy/volume limitation), it
remains the general tool for any boot-time problem, migration or otherwise.

## Before any manual write against the live database

1. Snapshot the db file on the volume to a timestamped copy first.
2. Make the change (e.g., the specific backfill statement a migration
   needs, or `npx prisma migrate resolve --applied <name>` if bookkeeping
   is out of sync — see MIGRATIONS.md's baselining section).
3. Verify with `npx prisma migrate status` before trusting it.
4. Delete the snapshot once the fix is verified and a normal deploy
   succeeds.

## Verifying recovery

1. `npx prisma migrate deploy` (or `migrate status`) clean on the live db.
2. Redeploy through the normal path (restore any start-command override
   first).
3. Poll `railway deployment list` until the new deployment shows `SUCCESS`.
4. `curl` the public domain and confirm `200`.
5. Tail runtime logs (`railway logs`) for the expected boot sequence, not
   just process-up.

## Golden paths

Not deploy recovery, but the same kind of thing: what to do when a check
goes red. `app/routes/goldenPath/` holds one reader's whole happy path as
recorded scenarios — signed out, sign in by magic link, shelf, open a book,
bookmark, highlight and note, commonplace book, sign out — replayed through
the real built server on every `npm run test:smoke`, CI included.

- **What is recorded.** Per step: status, redirect `Location`, content type,
  whether a cookie was set or cleared; for JSON, the body's _shape_ (keys,
  value types, array lengths) plus a few literal values the step names; for
  HTML, the `<title>` and whether a few landmark strings are present. Ids,
  timestamps, tokens and cookie values never reach a recording — they are
  replaced by placeholders (`<id:1>`, `<ts>`, `<token>`) or not recorded at
  all, which is what keeps the files byte-stable across runs and machines.
- **Replaying.** `npm run test:golden` (builds first), or
  `npm run test:smoke` for it and the `/api/v1` smoke suite together. No
  port, no browser, no API keys, and never `dev.db` — each run gets a
  throwaway SQLite copy.
- **When it fails.** Read the diff before anything else. A recording diff
  means a response changed shape, a redirect moved, or a page lost something
  it used to render. If that was the point of the change, re-record with
  `npm run golden:record` and commit the diff alongside it, so the reviewer
  sees the behaviour change as a change. If it wasn't, it's a regression —
  fix the code, not the recording.
- **What re-recording can't paper over.** Each step's `expectStatus`, its
  landmarks, and the database side effects asserted in
  `app/routes/goldenPath.smoke.test.ts` are checked independently of the
  recordings. `--update` will not turn a 500 green.
- **Adding a scenario.** Append to `scenarios` in
  `app/routes/goldenPath/scenarios.ts`, run `npm run golden:record`, read
  the new file under `recordings/`, commit both. Scenarios are chapters of
  one journey — they share a database and a cookie jar and run in order —
  so a new one inherits whatever state the earlier ones left. Renaming or
  removing one means deleting its recording too; the suite fails on a stale
  file.
- **Deliberately not here.** A real browser (`vitest.config.ts` explains why
  the test path doesn't drive one), so nothing client-side — selection,
  scrolling, optimistic UI — is covered. The Rig's SSE routes
  (`/api/v1/rig/*`), which need `ANTHROPIC_API_KEY` and the network. Upload
  and ingest. The iOS app.
