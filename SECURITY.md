# Security notes

A living list of areas worth revisiting, not a policy. Reading Rig is a
personal, single-user desktop tool today; several of these are fine at that
scope and become real problems only if the trust model changes (a second
user, a network-facing upload path, a public deploy). Each entry says which.

## Ingest pipeline (`app/domain/epub`)

- **No size/decompression limit on `unzipSync`.** A small, deliberately
  crafted zip can decompress to something enormous (a zip bomb) with no
  guard today. Low risk while EPUBs are files you already chose and supplied
  yourself via the CLI — becomes a real concern the moment anything ingests
  a file a user merely *uploaded* rather than *placed on disk themselves*.
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
- Rate limiting the login form (`POST /auth/login`) is not yet in place —
  worth adding before a public deploy, so requesting links can't be used to
  spam an arbitrary email address or brute-force-guess accounts.
- **`Work.id` is content-addressed from the book's OPF identifier alone**
  (see the comment on the `Work` model in `prisma/schema.prisma`) — a
  second user ingesting the same public-domain book would collide on that
  id and reassign ownership of the row. Documented there as a deliberate
  single-owner simplification; needs a real per-user shelf/copy model
  before accounts exist, not just a bigger hash.

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
