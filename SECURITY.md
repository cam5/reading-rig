# Security notes

A living list of areas worth revisiting, not a policy. Reading Rig is a
personal, single-user desktop tool today; several of these are fine at that
scope and become real problems only if the trust model changes (a second
user, a network-facing upload path, a public deploy). Each entry says which.

## Ingest pipeline (`app/domain/epub`)

- **(Fixed)** `unzipSync` had no decompression-size limit — a small,
  deliberately crafted zip could decompress to something enormous (a zip
  bomb) with no guard. Now capped: `unzipWithSizeCap` in `parseEpub.ts`
  uses `unzipSync`'s `filter` option, which fflate calls per entry _before_
  decompressing it and with the entry's declared `originalSize` — a running
  total across entries throws past 200MB, before any wasted decompression
  work, rather than after. Shared by every ingest path (CLI, seed library,
  `routes/upload.tsx`'s user-facing upload), since the fix lives in the
  parser itself, not any one caller.
- **`linkedom` parses untrusted markup in HTML mode**, not a full XML/DTD
  parser, so classic XXE / entity-expansion vectors are unlikely — but this
  hasn't been verified directly against `linkedom`'s own parser. Worth a
  real check before trusting it with anything but hand-picked EPUB sources,
  and before ever swapping in a different XML/HTML parsing library.
- **`sanitizeHtml.ts`'s allow-list is what stands between arbitrary
  book-source markup and whatever eventually renders `paragraph.html`.**
  It's a strict allow-list (`em`, `i`, `strong`, `b`, `sup`, `sub`, no
  attributes survive) — keep it that way. Never flip to a deny-list, and
  audit any future tag addition for attribute-based XSS (e.g. adding `a`
  without also stripping `href`/`on*` would reopen exactly what this file
  exists to close).

## Auth / multi-tenancy

- **Magic-link sign-in** (`app/magicLink.server.ts`, `app/auth/session.server.ts`,
  `app/routes/auth.*.tsx`) replaced the old "grab the oldest `User` row"
  stand-in. Tokens are single-use, 15-minute-lived, and stored as a sha256
  hash — never the raw value — so a database dump can't be replayed as a
  working link. The session cookie is signed (`SESSION_SECRET`) but not
  encrypted; don't put anything in it beyond `userId`.
- **The login form (`POST /auth/login`) is rate-limited**
  (`app/auth/rateLimit.server.ts`) — up to 3 requests per email and 10 per
  IP in a 15-minute fixed window, both counted on every attempt regardless
  of which is already tripped. In-memory, not persisted: correct as long as
  this runs as Railway's single configured container (see railway.toml);
  revisit if it's ever scaled to multiple replicas, since each would keep
  its own counters and the effective limit would multiply by replica count.
- **`Work.id` is content-addressed** (a slug plus a hash of the source
  file's bytes — `deriveWorkId`/`hashEdition` in `parseEpub.ts`), so two
  people uploading the very same file collide on the same `Work` row.
  `persistWork`'s upsert only sets `ownerId` on create, so a second
  uploader wouldn't become the owner — `routes/upload.tsx`'s action always
  upserts that uploader a `WorkGrant` afterward regardless, closing the
  gap the same way seed-library grants already do (shared rows, per-user
  `Highlight`/`ReadingPosition`). `scripts/ingest.ts`'s CLI path still
  doesn't do this — lower priority while it's a single trusted operator
  running it, not a stranger's upload, but worth the same fix if the CLI
  is ever handed to more than one person.
- **The upload route (`POST /upload`) is rate-limited** the same
  two-bucket way as login — 10 uploads per user and 20 per IP in a
  1-hour window — guarding the CPU cost of repeated parsing/decompression
  attempts, not a scarce resource. Same in-memory, single-container caveat
  as the login rate limit above.
- **The "not a copyrighted work" checkbox on `/upload` is a UX nudge, not
  enforcement.** It's required client- and server-side (the action
  rejects a submission without it before ever reading the file), but nothing
  here verifies a claim — same as any self-hosted upload form. If this
  Rig is ever exposed beyond one household, revisit with real moderation
  in mind.

## The agent's tool surface

- **The agent is deliberately read-only by design** (see the build-plan
  decision that save-to-margin is always a user action). That's not just a
  product choice — it's the actual safety margin against adversarial text
  embedded in an ingested book trying to steer the agent into doing
  something: there's no write path for a prompt injection to reach for.
  Keep this invariant intact as new tools are added; the guarantee comes
  from the agent having nothing to write with, not from trusting it to
  behave.
- **The spoiler boundary ("nothing past your bookmark") is a `WHERE` clause
  on `globalOrdinal`** at the query layer, not a prompt instruction. Any
  new retrieval path built for the agent must keep that boundary as a query
  condition on what's fetched — never as an instruction asking the model
  not to look ahead.

## Secrets

- `DATABASE_URL` and any future API keys go through `dotenv`/`.env`,
  correctly gitignored already. Re-confirm this as more secrets
  (Managed Agents credentials, etc.) get added — a new `.env.*` variant or
  a checked-in example file is an easy place for this to quietly regress.

## Deploy

- (Fixed) `generated/prisma/client` wasn't produced by any build step,
  breaking every deploy that touched `app/db.server.ts` — a `postinstall`
  hook now covers it. Worth checking any future generated output (a second
  Prisma generator, a codegen step) gets the same treatment rather than
  being caught by a failed deploy again.
