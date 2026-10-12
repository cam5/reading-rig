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

### Reading the logs

Everything the server logs at runtime goes through `app/log.server.ts`, so
every line has the same shape and can be grepped by scope:

```
[scope] message key=value key=value
<the thrown error and its stack, if there was one>
```

`railway logs | grep '\[rig-session\]'` narrows to one scope. Fields are ids,
counts and sizes only — never highlight/note/message text, tokens, or
cookies — so an id from a log line is what you take to the database.
The one exception is the `email` fallback at the bottom of the table.

| Scope                 | Level | Line                                                                | What it means                                                                                                                                                                                                                                    |
| --------------------- | ----- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request`             | error | `unhandled error`                                                   | A loader, action or render threw and no `ErrorBoundary` caught it — the reader saw an error page. `method`/`path` say which request (path only; query strings are never logged).                                                                 |
| `render`              | error | `streaming render failed`                                           | Something threw while streaming HTML _after_ the shell was sent. The reader got a partial page.                                                                                                                                                  |
| `error-tracking`      | warn  | `could not report exception`                                        | The `request` error above couldn't be forwarded to PostHog (usually: no signed-in user to attribute it to). The error itself was still logged.                                                                                                   |
| `rig-session`         | error | `session loop failed`                                               | The Rig's SSE stream ended with an error; the browser was sent an `error` event. The attached error is the cause — usually an Anthropic API failure.                                                                                             |
| `rig-session`         | error | `tool dispatch rejected`                                            | A dispatch function rejected outright. The agent was told `Tool call failed`. `dispatchTool` is supposed to never throw, so this is a bug.                                                                                                       |
| `rig-session`         | warn  | `stream dropped; reconnecting`                                      | The stream to Anthropic dropped mid-turn and was reopened. Harmless once; the same `sessionId` repeating in a tight loop means it isn't recovering.                                                                                              |
| `rig-session`         | warn  | `stale Anthropic session replaced; retrying`                        | Anthropic no longer had the session a `RigSession` row named, so the row was pointed at a new one. That conversation's transcript is gone. Many at once means sessions are expiring en masse — or the workspace/API key changed.                 |
| `rig-dispatch`        | error | `tool call threw`                                                   | One of the Rig's tool handlers threw (most often a database error). The agent got the message as a tool result and carried on.                                                                                                                   |
| `rig-provisioning`    | warn  | `agent or environment not found on session create; re-provisioning` | The stored agent/environment id didn't resolve when creating a session; the Rig is re-provisioning itself on this request.                                                                                                                       |
| `rig-provisioning`    | warn  | `agent not found…` / `environment not found; creating a new one`    | The follow-on to the line above (or the same discovery at deploy time): a fresh agent/environment was created and its id stored. Expected right after a staging-qa reset; on production it means something deleted them.                         |
| `rig-provisioning`    | info  | `… already matches; skipping update`                                | Deploy-time convergence found nothing to change. The normal case.                                                                                                                                                                                |
| `upload`              | warn  | `file did not parse as an EPUB`                                     | A reader's upload was rejected with "That didn't parse as an EPUB." The attached error says why.                                                                                                                                                 |
| `mention-suggestions` | error | `search failed, returning no suggestions`                           | The "@" autocomplete query failed and degraded to an empty list rather than breaking the page. Repeating means the database is unhappy.                                                                                                          |
| `api-token`           | error | `failed to record lastUsedAt`                                       | A Bearer request authenticated fine but its `lastUsedAt` write failed. The request itself was unaffected.                                                                                                                                        |
| `analytics`           | warn  | `could not report …` / `could not flush before shutdown`            | PostHog reporting failed and was swallowed. Never affects a reader.                                                                                                                                                                              |
| `email`               | warn  | `RESEND_API_KEY not set in a real-auth environment…`                | Production or staging-qa has no `RESEND_API_KEY`, so the `info` line that follows contains a live sign-in link. Sign-in still works (that logged link is the only way it does), but anyone who can read these logs can use it. Set the variable. |
| `email`               | info  | `RESEND_API_KEY not set — magic link for …`                         | The no-key fallback: the link is printed instead of emailed. Normal in local dev and PR environments.                                                                                                                                            |

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
