# Runbooks

What to do when something is broken, by symptom. Each runbook runs
symptom → diagnose → fix → verify, and every claim in it is drawn from the
code it names — if the code and this file disagree, the code is right and
this file needs a fix.

See [MIGRATIONS.md](./MIGRATIONS.md) for how schema changes are supposed to
ship, and [AGENTS.md](./AGENTS.md) for the worktree `.env` rule.

| Symptom                                                                    | Runbook                                                                             |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A deploy is `CRASHED`, stuck retrying, or the site is serving an old build | [Triaging and recovering a broken deploy](#triaging-and-recovering-a-broken-deploy) |
| The Rig panel shows an error, or a Rig request 500s/503s/404s              | [The Rig is failing](#the-rig-is-failing)                                           |
| staging-qa needs a branch on it, or its data is missing or reset           | [staging-qa](#staging-qa)                                                           |
| A PR's preview environment is broken, empty, or has no Rig                 | [PR preview environments](#pr-preview-environments)                                 |
| Local app errors on a missing column/table, or rows are in the wrong file  | [Local dev database problems](#local-dev-database-problems)                         |
| Can't sign in, no magic-link email arrives, or everyone was signed out     | [Sign-in and magic-link problems](#sign-in-and-magic-link-problems)                 |
| No events in PostHog, or stack traces point into minified chunks           | [Analytics or source-map upload is quiet](#analytics-or-source-map-upload-is-quiet) |
| "Is this variable required here, and what happens without it?"             | [Environment variable reference](#environment-variable-reference)                   |

## Triaging and recovering a broken deploy

See [MIGRATIONS.md](./MIGRATIONS.md) for how schema changes are supposed to
ship. This is what to do when a deploy breaks anyway.

### Railway settings reference

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

### Health snapshot → logs → classify

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

### Getting a shell on a crash-looping or otherwise stuck service

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

### Before any manual write against the live database

1. Snapshot the db file on the volume to a timestamped copy first.
2. Make the change (e.g., the specific backfill statement a migration
   needs, or `npx prisma migrate resolve --applied <name>` if bookkeeping
   is out of sync — see MIGRATIONS.md's baselining section).
3. Verify with `npx prisma migrate status` before trusting it.
4. Delete the snapshot once the fix is verified and a normal deploy
   succeeds.

### Verifying recovery

1. `npx prisma migrate deploy` (or `migrate status`) clean on the live db.
2. Redeploy through the normal path (restore any start-command override
   first).
3. Poll `railway deployment list` until the new deployment shows `SUCCESS`.
4. `curl` the public domain and confirm `200`.
5. Tail runtime logs (`railway logs`) for the expected boot sequence, not
   just process-up.

## The Rig is failing

The Rig has three layers that can each go missing, and each already
repairs itself once on the next request. Start from what the panel or the
server log actually says.

### What the reader sees → what it means

- **"The Rig isn't set up in this environment (no Anthropic API key
  configured here)."** — `ANTHROPIC_API_KEY` is unset
  (`rigUnavailableReason` in `app/rig/anthropicSessionClient.ts`). A direct
  `POST /api/v1/rig-sessions/<workId>` returns the same text as a `503`.
  This is the expected, permanent state of a PR preview environment, not a
  fault there. Anywhere else, set the key and restart.
- **"Couldn't start a new session — try again."** —
  `POST /api/v1/rig-sessions/<workId>` returned a non-2xx
  (`app/rig/useRigSessions.ts`, surfaced by `RigLivePanel`). The panel
  deliberately doesn't say why; the server log does. Go to the next
  section.
- **A raw `404 … "Session not found: sesn_…"`** — a stored
  `RigSession.anthropicSessionId` no longer exists on Anthropic's side. See
  [Stale sessions](#stale-sessions) below.

### Diagnose a failing session create

1. Read the server log for the failing request (the dev server's terminal
   locally; `railway logs` on a deployed environment).
2. **A SQLite constraint or missing-column/table error** — the database is
   behind `prisma/schema.prisma`. Locally, follow
   [Local dev database problems](#local-dev-database-problems). On a
   deployed environment this means the release step didn't apply
   migrations; treat it as a
   [broken deploy](#triaging-and-recovering-a-broken-deploy).
3. **An Anthropic API error that isn't a 404** (authentication, permission,
   rate limit) — the key itself is the problem. Nothing in the app retries
   these; fix the key or wait out the limit.
4. **A `RigProvisioning.agentId=… was not found` warning** (or the
   `environmentId` equivalent), followed by "creating a new agent
   instead" — not a failure. That's
   `ensureRigProvisioning` (`app/rig/rigProvisioning.ts`) replacing an
   agent or environment that no longer resolves, and saving the new ids.

### The `RigProvisioning` row

The agent id, agent version and environment id live in a singleton
`RigProvisioning` row (`id = "rig"`), not in `.env` or Railway Variables.

- **A missing row is not fatal.** `createAnthropicSessionClient` calls
  `ensureRigProvisioning` on demand when the row is absent, so the first
  Rig request after a database reset provisions it.
- **To provision or converge by hand:** `npm run agent:setup`. It's
  idempotent — it creates the agent and environment only if there's no row
  or the stored ids don't resolve, and otherwise updates them in place
  (skipping the update when nothing changed). It exits non-zero with a
  clear message if `ANTHROPIC_API_KEY` is unset.
- **To look at the row locally:**
  `sqlite3 dev.db "SELECT * FROM RigProvisioning;"`
- `scripts/release.ts` runs the same script on every boot when
  `ANTHROPIC_API_KEY` is set, and logs that the key is not set and it is
  "skipping agent convergence" when it isn't. A real `setup-agent` failure fails the
  release, same as a failed migration.

`READING_RIG_AGENT_ID`, `READING_RIG_AGENT_VERSION` and
`READING_RIG_ENVIRONMENT_ID` in an old `.env` or in Railway Variables are
leftovers: nothing reads them any more. Editing them changes nothing.

### Stale sessions

`withRigSessionRecovery` (`app/rig/rigSession.ts`) wraps both the SSE
stream and the send in `app/routes/api.v1.rig.tsx`. On Anthropic's specific
"Session not found" 404 it creates a fresh Anthropic session, points the
existing `RigSession` row at it, and retries once.

- **The earlier conversation is gone when this fires.** There is no local
  copy of a transcript to replay; recovery trades it for a working panel.
- **A second failure surfaces rather than looping.** If the 404 persists
  after one retry, the cause is not a stale session id — read the log for
  what the retry actually hit.
- A plain `404 Rig session not found` (no `sesn_` id) is different: the
  `?session=<id>` in the request doesn't name a `RigSession` owned by this
  user for this work.

### Agent and environment ids change between boots

Issue [#113](https://github.com/cam5/reading-rig/issues/113) (ids written
to a release container's `.env` never reached Railway's persisted
Variables, so every deploy recreated and abandoned an agent) is **closed**:
the ids now live in the database, which is as durable as the volume it's
on.

That durability is the whole story, in both directions:

- **Production** keeps its row across deploys, so ids are stable.
- **staging-qa and PR previews with a key** reset their database on every
  boot (see [staging-qa](#staging-qa)), which deletes the row, so
  `setup-agent` creates a brand-new agent and environment each boot. New
  ids in those logs on every boot are expected. The previous agent and
  environment are not deleted from Anthropic by anything in this repo.

### Verify

1. Open the Rig on any book; the panel shows a composer, not an error.
2. Send a message and see a reply stream in.
3. On a deployed environment, the boot log shows `Agent ready: …` and
   `Environment ready: …`.

## staging-qa

A stable, named Railway environment duplicated from production, at
`staging.reading-rig.com`. It requires real sign-in like production
(`app/env.server.ts`), but its data is disposable like a PR preview's
(`scripts/release.ts`).

### Deploying a branch to it

1. `gh workflow run deploy-qa.yml --ref <branch>` — or "Run workflow" on
   **Deploy to staging-qa** in the Actions tab. It's manual-only
   (`workflow_dispatch`); nothing deploys there automatically.
2. `gh run watch` to follow the workflow run. Runs share one concurrency
   group and queue rather than cancel each other.
3. **A green workflow run is not a successful deploy.** The job calls
   `railway up --detach`, which returns once the upload is accepted. Check
   the deployment itself with `railway deployment list` and `railway logs`
   against the `staging-qa` environment, exactly as in
   [Health snapshot → logs → classify](#health-snapshot--logs--classify).
4. Each run overwrites whatever branch was there before.

### The database resets on every boot

This is by design, not a fault. `scripts/release.ts` treats every Railway
environment whose `RAILWAY_ENVIRONMENT_NAME` isn't `production` as
ephemeral, and on each boot runs, in order: `prisma migrate reset --force`,
`prisma/seed.ts`, `scripts/ingest.ts` for both fixture books,
`scripts/seedLibrary.ts`, then `scripts/setup-agent.ts` if the key is set.

"Every boot" means every container start, not only every deploy. If the
service is configured in the Railway dashboard to sleep when idle, each
wake is a fresh container that runs the whole sequence again. (Sleep
settings live in the dashboard, not `railway.toml`, so check there rather
than assuming.)

What that means in practice:

- Accounts, highlights, notes, bookmarks, uploaded books and Rig sessions
  created on staging-qa do not survive a redeploy or restart. Sign in
  again and expect only the fixture books and seed library.
- Never put anything on staging-qa you'd mind losing.

### Seeded data is missing after a boot

**Symptom:** the boot log says both fixture books were ingested and the
agent is ready, but the app shows one book, or the Rig re-provisions on
first use.

This is issue [#145](https://github.com/cam5/reading-rig/issues/145), and
it is **open**. The observation is solid — a boot logged success for
steps whose rows a direct query minutes later didn't find, with no restart
in between. The cause is not established.

- **Hypothesis only:** WAL checkpoint timing across the handoff between
  the separate child processes `release.ts` runs, each opening its own
  connection to the same SQLite file. Nobody has instrumented this; don't
  act on it as fact.
- **Not affected:** the Rig. A missing `RigProvisioning` row is created on
  the next request (see [The Rig is failing](#the-rig-is-failing)).
- **Workaround:** redeploy (step 1 above). That reruns the whole reset and
  seed sequence. Compare the app against the boot log afterwards rather
  than trusting the log alone.
- If you can reproduce it, add what you saw to #145 — row counts against
  the boot log's claims are the missing evidence.

### A variable looks missing from `railway variables`

Sealed variables are left out of the listing entirely rather than shown
masked. `ANTHROPIC_API_KEY` on staging-qa has been observed to be one of
these. Absence from the listing is not absence from the environment —
confirm from behaviour instead: the boot log either runs `setup-agent`
(`Agent ready: …`) or prints the "skipping agent convergence" line.

### Verify

1. `curl -sS -o /dev/null -w '%{http_code}\n' https://staging.reading-rig.com/healthz`
   returns `200`. This only proves the server process is up — `/healthz`
   deliberately touches no database.
2. Sign in and confirm both fixture books are on the shelf. That's the
   check that the seed actually landed.

## PR preview environments

Railway creates one per PR and tears it down when the PR closes. They are
the most forgiving environment and the least like production.

### What's different there, on purpose

- **The database is reset and reseeded on every boot** — the same
  ephemeral branch of `scripts/release.ts` as
  [staging-qa](#the-database-resets-on-every-boot).
- **No real sign-in.** `requiresRealAuth()` (`app/env.server.ts`) is true
  only for `production` and `staging-qa`, so a preview signs every visitor
  in as the oldest `User` row — the seeded one — and needs no
  `SESSION_SECRET`.
- **No Rig**, unless someone has added a key to that environment. Previews
  aren't given `ANTHROPIC_API_KEY`, release logs the "skipping agent
  convergence" line, and the panel shows the "isn't set up in this
  environment" message.
- **No email, no analytics, no source-map upload** unless their keys are
  set there; each of those is a no-op without its key (see the
  [reference table](#environment-variable-reference)).

### Is this a preview problem or a production problem?

1. `railway status` — the environment name tells you which one you're
   linked to. A preview's public URL is a Railway-generated
   `*.up.railway.app` address; production is `reading-rig.com`.
2. **If it fails in a preview but the same commit would have real rows
   under it in production, a green preview proves little.** Previews
   migrate from an empty database every time, so a migration that needs a
   backfill passes there and fails only against production's existing
   rows. That's the case [MIGRATIONS.md](./MIGRATIONS.md) exists for.
3. **If a preview is crash-looping**, classify it with
   [Health snapshot → logs → classify](#health-snapshot--logs--classify).
   Nothing about a preview is worth recovering by hand: fix the branch and
   push, or close and reopen the PR for a fresh environment.
4. **If a preview comes up but 500s on every route with an empty
   database**, check that nothing has reintroduced a
   `deploy.preDeployCommand` — see the
   [Railway settings reference](#railway-settings-reference) for why that
   can't work.

## Local dev database problems

### The app errors on a missing column, table or constraint

**Symptom:** a loader or action throws a SQLite error after pulling new
commits; or the Rig's session create fails (see
[The Rig is failing](#the-rig-is-failing)).

1. `npx prisma migrate status` — lists migrations committed but not yet
   applied to your `dev.db`.
2. `npx prisma migrate deploy` — applies them. It only ever applies
   committed migrations; it doesn't reset or reseed.
3. `npx prisma migrate status` again; it should report the database is up
   to date.

Use `migrate deploy` for catching up, not `npm run db:migrate`. The latter
is `prisma migrate dev`, which is for authoring a new migration and will
offer to reset the database if it decides your history has drifted.
Decline that prompt unless you mean it.

### Which `dev.db` is the real one

`DATABASE_URL="file:./dev.db"` is a relative path, and both the Prisma CLI
(via `prisma.config.ts`) and the app's client resolve it from the
directory you run commands in — the repo root. The database is the root
`dev.db`.

A `prisma/dev.db` may also exist on a machine that has run older tooling.
If it's there and zero bytes, it's a leftover and nothing reads it. Check
before drawing conclusions from the wrong file:

```bash
ls -la dev.db prisma/dev.db
```

### Rows are landing in another checkout's database

Because the path is relative, a git worktree gets its own database only if
it has its own `.env`. Before running `npm run dev`, `npm run release` or
any browser-based check in a worktree:

```bash
test -f .env || cp .env.example .env
```

[AGENTS.md](./AGENTS.md) has the full reasoning. The short version: rows
written into the primary checkout's `dev.db` by mistake look exactly like
real reading data, and nothing cleans them up.

### What will and won't delete your local data

- `npm run release` run locally applies committed migrations and nothing
  else — the reset branch only runs when `RAILWAY_ENVIRONMENT_NAME` is set
  to something other than `production`, which it never is on your machine
  unless you set it. Don't.
- `npm run db:seed`, `npm run ingest <path.epub>` and
  `npm run seed:library` only upsert, by deterministic id. Rerunning them
  is safe and leaves bookmarks, highlights and notes alone.
- `prisma migrate reset`, and accepting a reset prompt from
  `npm run db:migrate`, delete everything.

### Signed out locally, or bounced to `/auth/login`

Local dev signs you in as the oldest `User` row automatically. If there
isn't one, there's nobody to sign in as: run `npm run db:seed`.

## Sign-in and magic-link problems

### A deploy won't boot: `SESSION_SECRET must be set in production.`

`app/auth/session.server.ts` throws this at startup when `SESSION_SECRET`
is unset and the environment is `production` or `staging-qa`. From the
outside it's a runtime/config failure: the previous deployment keeps
serving while retries run out.

1. Set `SESSION_SECRET` on that environment to a long random value.
2. Redeploy, then follow [Verifying recovery](#verifying-recovery).

The cookie is signed with exactly one secret, so **changing
`SESSION_SECRET` signs everyone out**. That's the right move if the secret
may have leaked, and an unwelcome surprise otherwise.

### No magic-link email arrives

Work down this list; each step is a different cause.

1. **Is email configured at all?** Without `RESEND_API_KEY`, sending is a
   no-op that logs the link instead:

   ```
   [email] RESEND_API_KEY not set — magic link for <email>:
   ```

   Find that line in the server log (`railway logs` when deployed) and
   open the URL under it. This is the normal way to sign in locally.

2. **Is the sender allowed to reach that address?** With
   `RESEND_FROM_EMAIL` unset, mail is sent from `onboarding@resend.dev`,
   which Resend delivers only to the Resend account's own verified
   address. Anyone else gets nothing. Set `RESEND_FROM_EMAIL` to an
   address on a domain verified with Resend.
3. **Did the send fail outright?** A Resend error is thrown as
   `Failed to send magic link email: <reason>`, so the login form's submit
   errors rather than showing "sent". The reason is in the server log.
4. **"Too many attempts. Try again in a few minutes."** — the login form
   allows 3 requests per email and 10 per IP in a 15-minute window
   (`app/routes/auth.login.tsx`). The counters are in memory, so they also
   clear when the container restarts.

### The link arrives but doesn't work

- **"That link has expired."** — links live 15 minutes
  (`app/magicLink.server.ts`). Request another.
- **"That link has already been used."** — links are single-use. If the
  reader swears they only clicked once, something opened it first: a mail
  client or security scanner that prefetches links consumes the token.
  Request another and open it promptly.

### Verify

1. Request a link, receive it (or read it from the log), and land signed
   in on the page you were headed to.
2. Reload; you stay signed in.

## Analytics or source-map upload is quiet

Both are designed to do nothing, silently, when unconfigured. Rule out
configuration before reading any code.

### No events in PostHog

1. **Is `POSTHOG_PROJECT_API_KEY` set in that environment?** Without it
   `track()` is a no-op — no client is constructed and nothing is logged
   (`app/analytics.server.ts`). Local dev, tests, CI and PR previews are
   normally in this state.
2. **Is the project on EU Cloud or self-hosted?** Then `POSTHOG_HOST` must
   be set; the default is US Cloud, and events sent to the wrong host
   don't appear in your project.
3. **Is the server log showing `[analytics] could not report <event>:`?**
   `track()` never throws; failures are logged there and swallowed so a
   highlight still saves.
4. **Has the event actually fired?** Events are reported from the server,
   by the loader or action that did the work — a request that failed
   validation reports nothing. The three client-only events
   (`rig_session_switched`, `section_navigated`, `rig_opened`) go through
   the `/b` beacon route instead.

### Stack traces in PostHog point into minified chunks

Source maps are uploaded at **build** time by the PostHog plugin in
`vite.config.ts`, and only when both `POSTHOG_CLI_API_KEY` and
`POSTHOG_CLI_PROJECT_ID` are present in the build's environment. With
either missing the build skips the upload and says nothing.

1. Confirm both are set where the build runs, not just at runtime.
2. `POSTHOG_CLI_API_KEY` is a _personal_ API key with "error tracking
   write" and "organization read" scopes. The project key from the section
   above is a different secret and won't work here.
3. Rebuild and redeploy; maps are uploaded for new builds only.

## Environment variable reference

Drawn from [`.env.example`](./.env.example) and the code that reads each
one. Deployed values are Railway variables per environment; none are
committed.

| Variable                   | Required where                                          | When it's missing                                                                                                         |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | Everywhere                                              | Nothing that touches the database works. Locally, `cp .env.example .env`.                                                 |
| `SESSION_SECRET`           | `production`, `staging-qa`                              | The server refuses to boot there. Elsewhere an insecure dev value is used.                                                |
| `ANTHROPIC_API_KEY`        | Wherever the Rig should work                            | Release skips agent convergence; the Rig panel says it isn't set up here; `npm run agent:setup` exits non-zero.           |
| `RESEND_API_KEY`           | Wherever sign-in emails must really be sent             | Magic links are logged to the console instead of emailed.                                                                 |
| `RESEND_FROM_EMAIL`        | With `RESEND_API_KEY`, to reach arbitrary addresses     | Mail is sent from `onboarding@resend.dev` and reaches only the Resend account's own address.                              |
| `POSTHOG_PROJECT_API_KEY`  | Wherever events should be reported                      | `track()` and exception capture are silent no-ops.                                                                        |
| `POSTHOG_HOST`             | EU Cloud or self-hosted PostHog only                    | Events and source maps go to US Cloud.                                                                                    |
| `POSTHOG_CLI_API_KEY`      | At build time, with the project id, for readable traces | The build skips the source-map upload.                                                                                    |
| `POSTHOG_CLI_PROJECT_ID`   | At build time, with the key above                       | The build skips the source-map upload.                                                                                    |
| `DEV_USER_EMAIL`           | Optional, local                                         | The seeded user's email is `dev@localhost`.                                                                               |
| `RAILWAY_ENVIRONMENT_NAME` | Injected by Railway; never set by hand                  | Unset means "not Railway": no database reset, no real-auth requirement. Any value but `production` resets the db on boot. |

Two more live in GitHub Actions secrets rather than the app's environment:
`RAILWAY_TOKEN` (the staging-qa deploy workflow can't deploy without it)
and `CHROMATIC_PROJECT_TOKEN` (without it the Chromatic publish step is
skipped rather than failed).
