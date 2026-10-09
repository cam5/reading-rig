# Privacy audit

Audited 2026-10-09 against `main` at `98ab6df`. A point-in-time check of what
the code does with personal data against what the repo says it does.

**There is no privacy policy in this repo** — no `PRIVACY.md`, no `/privacy`
route. The privacy statements already written in code comments and docs were
used as the de facto policy. That is an assumption, not a finding: if a policy
exists somewhere outside the repo, this audit has not been checked against it.

Read-only audit of source. Nothing was run against a live deploy, PostHog
project, Resend account or Anthropic workspace, so anything that depends on
their settings is marked Unverifiable.

## Summary

| Severity | Count | What                                                                                                                         |
| -------- | ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| High     | 0     |                                                                                                                              |
| Medium   | 4     | Token in analytics URL (fixed); no deletion or retention limits; Rig data flow to Anthropic undocumented; magic link in logs |
| Low      | 6     | See findings F5–F10                                                                                                          |

Fixed in this change: F1, F2, and three stale comments/docs (F9). Everything
else is reported only.

## Claims versus code

| #   | Claim                                                                                                                         | Where stated                                            | Verdict                                  | Evidence                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | Analytics never sends the text of a highlight or note; events carry a length and a locator                                    | `app/analytics.server.ts:30`                            | Consistent                               | All 12 events in the `AnalyticsEvent` union carry only ids, ordinals, counts, booleans, enums, a derived locator and a book title. `handleReadAction.server.ts` derives `bodyLength`/`excerptLength`/`textLength` and never passes the strings. Now enforced for every event by `app/analytics.server.test.ts:363`.                                      |
| a′  | The same rule for Rig messages ("never the message itself")                                                                   | `app/analytics.server.ts` (`rig_message_sent`)          | Consistent, one gap fixed                | `api.v1.rig.tsx:209` sends `messageLength` only. Gap: see F2.                                                                                                                                                                                                                                                                                            |
| b   | No email or other PII on `signed_up` / `signed_in`; `distinctId` is the User id                                               | `app/analytics.server.ts:260`                           | Consistent for email; **F1** for the URL | `auth.verify.tsx:46` sends one boolean and `distinctId: user.id`. No email reaches PostHog from any call site. But the event's `$current_url` was the verify URL including the raw magic-link token — fixed.                                                                                                                                             |
| c   | The `/b` beacon reports lengths and counts, not third-party tracking                                                          | `app/routes.ts:24`                                      | Mostly consistent (F5, F9)               | The three beacon events are counts/flags/enums. The beacon also sends the page URL and title, which the comment didn't say (comment corrected). The route allowlists event _names_ only; property keys are forwarded unvalidated (`analytics-beacon.tsx:59-63`).                                                                                         |
| d   | Analytics, email and source-map upload are no-ops without their keys                                                          | `.env.example:25,34,44`                                 | Consistent                               | `getClient()` returns null and never imports `posthog-node` without `POSTHOG_PROJECT_API_KEY` (tested). `email.server.ts:21` logs instead of sending. `vite.config.ts` omits the plugin without both CLI vars. "No-op" for email means "logs the link" — see F4.                                                                                         |
| e   | Session cookie is signed, not encrypted, and holds only `userId`; login and upload are rate-limited per email/user and per IP | `SECURITY.md:36-46`                                     | Consistent                               | `session.server.ts:26-34`: `httpOnly`, `sameSite: lax`, `secure` in production, 30-day `maxAge`, only `userId` set. Limits match the doc exactly: 3/email and 10/IP per 15 min (`auth.login.tsx`), 10/user and 20/IP per hour (`upload.tsx`). Magic-link tokens are sha256-hashed, single-use, 15 minutes (`magicLink.server.ts`).                       |
| f   | "Single user, local SQLite, no accounts"; "one file you own"; data survives reseeds                                           | `README.md`, `.env.example`, `AGENTS.md`                | **Inconsistent** (README, fixed)         | True of local dev. Deployed environments have real multi-user accounts keyed by email (`auth.verify.tsx`, `env.server.ts`), and the SQLite file is on a Railway volume, not the user's machine. README corrected. "Survives reseeds" is consistent: no `delete`/`deleteMany` call exists anywhere in `app/`, `scripts/` or `prisma/` — which is also F3. |
| g   | The #78 rule "as an assertion rather than a comment"                                                                          | `app/analytics.server.test.ts:326`                      | Was partial, now consistent              | The assertion covered `note_created` only. Extended to every event name.                                                                                                                                                                                                                                                                                 |
| —   | No autocapture, no session replay, no geo-IP                                                                                  | `app/analytics.server.ts` header                        | Consistent                               | `enableExceptionAutocapture: false`, `disableGeoip: true` (`:517-520`, tested). `posthog-js` is not a dependency; no third-party script, font or pixel is loaded by `root.tsx` (fonts are self-hosted).                                                                                                                                                  |
| —   | The agent is read-only and cannot see past the bookmark                                                                       | `SECURITY.md` ("The agent's tool surface"), `README.md` | Consistent, but incomplete (F6)          | Only `search_shelf` is registered (`agentConfig.ts:89`), bookmark-bounded in the query. No write tool exists. The claim says nothing about what is _sent_ to Anthropic or about `web_fetch` as an outbound channel.                                                                                                                                      |

## Findings

### F1 — Magic-link token was sent to PostHog in `$current_url` (Medium, fixed)

`auth.verify.tsx:53` passes `canonicalRequestUrl(request)` as the event's page
URL, and that request URL is `/auth/verify?token=<raw token>`. Every
`signed_up`/`signed_in` event therefore carried the raw token to a third
party, despite the token being hashed at rest specifically so the raw value is
never kept (`SECURITY.md:36`). The token is already consumed by the time the
event fires, so it could not be replayed — which is why this is Medium rather
than High — but it is a credential leaving the system for no reason.

Fix: `canonicalRequestUrl` now drops the `token` query parameter
(`app/analytics.server.ts:459`), which covers both `track()` and
`captureException()`. Tokens already sent sit in existing PostHog events;
they are all expired and consumed.

### F2 — Mention-search text could reach PostHog through error reports (Low, fixed)

`/api/v1/mention-suggestions?q=…` carries what the reader typed after "@" in
the Rig composer. No `track()` call fires there, but `entry.server.tsx:126`
reports the request URL with any unhandled exception. The same fix drops `q`.

### F3 — No deletion, export or retention limit for any personal data (Medium, reported)

- There is no account deletion or data export route, and no script for either.
- `MagicLinkToken` rows (`schema.prisma:39`) are never deleted. Each holds an
  email address, including addresses typed into the login form by someone who
  never completed sign-in, so the table accumulates emails of non-users
  indefinitely.
- `ApiToken` rows are revoked, not deleted (documented as intentional).
- Anthropic-side Rig sessions are never deleted; the `RigSession` row is
  described as resumable indefinitely.
- Sign-out clears the cookie but cannot revoke it server-side; a copied cookie
  stays valid for up to 30 days.

The schema cascades from `User` to everything it owns, so deletion is cheap to
add — with one catch: `Work.owner` also cascades, so deleting the first
uploader of a book would delete it for every other user who holds a
`WorkGrant` to the same content-addressed `Work`.

### F4 — A production deploy without `RESEND_API_KEY` logs live magic links (Medium, reported)

`email.server.ts:21` prints the address and a working sign-in link to stdout
whenever the key is unset. `SESSION_SECRET` is enforced at boot where real
auth is required (`session.server.ts`); `RESEND_API_KEY` is not. On production
or staging-qa a missing key would write working credentials and email
addresses into Railway's log retention. Whether the key is set there is
Unverifiable from the repo.

### F5 — Book titles and reading activity are tied to a user id in PostHog (Low, undocumented flow)

Not a contradiction of any claim, but nothing states it. Every read-page event
carries `workId` (a slug built from author and title), `$screen_name` (the tab
title, which is the book title) and `$current_url`; `work_opened` and
`epub_ingested` carry `title` outright (`read.tsx:152`, `upload.tsx:99`). For
an uploaded EPUB the title is the user's own content. Together with
`bookmark_updated` this is a per-user reading history held by a third party.

Also here: the beacon route forwards any extra property keys a client sends
(`analytics-beacon.tsx:59-63`). The first-party client only sends counts, and
`sameSite: lax` blocks cross-site posts, so this is hardening rather than a
leak.

### F6 — What the Rig sends to Anthropic is not stated anywhere (Medium, undocumented flow)

The analytics header's "a margin is not a third-party payload" is scoped to
analytics. The Rig sends considerably more to Anthropic, by design:

- Every message the reader types, verbatim (`api.v1.rig.tsx:195-202`).
- The book text on screen when the panel is opened, plus title and author
  (`buildLaunchContext.ts`, prepended in `RigLivePanel.tsx:196`).
- Selected passages and @-mentioned passages **and notes**, serialized into
  the message as `⟦pill⟧` tags — this is the one path by which note text
  leaves the server today.
- `search_shelf` results: matching paragraphs up to the bookmark.

Not sent: email, user id, or highlights as such. `list_my_notes`,
`get_passage` and `get_surrounding` have live branches in `dispatchTool.ts`
(`:114-165`) but are not registered on the agent, so the model cannot call
them; registering `list_my_notes` would send every note on the shelf.

The agent has `web_search` and `web_fetch` enabled (`agentConfig.ts:72-73`).
`SECURITY.md` argues a prompt injection in a book has "no write path to reach
for". That holds for writes, but `web_fetch` is an outbound channel: injected
text in a book or a fetched page could direct the agent to request a URL that
encodes conversation content. The container itself has no network egress
(`environmentConfig.ts`); the server-side web tools are separate from that.

Transcripts are stored on Anthropic's side for the life of the session, and
are not deleted by anything here (F3).

### F7 — Exception messages may carry user content (Low, unverifiable)

`captureException` sends the error object as thrown. Prisma validation errors
print the failing call's arguments in their message, so an error thrown from
`entry.create` could include a note body. Thrown `Response`s (the 400/404
paths) do not reach `handleError`. No such error was reproduced; this is a
property of the dependency, not an observed leak. The same errors go to
`console.error` and therefore to Railway logs.

### F8 — iOS token storage (Low, informational)

The Bearer token and server URL are stored in the Keychain with
`kSecAttrAccessibleAfterFirstUnlock` (`AuthSession.swift:101`), which is not
the `ThisDeviceOnly` variant, so the item is included in encrypted device
backups and migrations. No analytics, crash-reporting or other third-party SDK
is linked — the only package dependencies are Apple's OpenAPI runtime
libraries. Nothing is written to `UserDefaults`.

### F9 — Stale statements corrected

- `README.md` said "Single user, local SQLite, no accounts".
- `TrackContext.distinctId`'s comment said the id is always `local-user` and
  spoke of real auth as future work.
- `app/routes.ts` said the beacon reports only lengths and counts.

### F10 — Smaller observations (Low)

- The login rate limiter holds email addresses and IP addresses in process
  memory as bucket keys for the window (`rateLimit.server.ts`); not persisted,
  swept opportunistically.
- A Rig session id is written into the page URL by `RigLivePanel`, so it
  appears in `$current_url` on beacon events. An internal id, not content.
- No `localStorage`, `sessionStorage` or non-session cookie is used anywhere
  in `app/` or `lib/`.
- Source-map upload sends application source to PostHog, not user data.

## Data inventory

### Stored (SQLite: a local file in dev, a Railway volume when deployed)

| Data             | Model                            | Notes                                                                  |
| ---------------- | -------------------------------- | ---------------------------------------------------------------------- |
| Email address    | `User`, `MagicLinkToken`         | Lowercased. `MagicLinkToken` keeps it even if sign-in never completes. |
| Sign-in tokens   | `MagicLinkToken`, `ApiToken`     | sha256 hash only. Never deleted.                                       |
| Highlights       | `Highlight`, `HighlightSpan`     | Offsets into paragraphs, per user.                                     |
| Notes            | `Entry`                          | `body` and `contextSnapshot.excerpt` are free text.                    |
| Reading position | `ReadingPosition`                | One per user and work.                                                 |
| Uploaded books   | `Work` → `Paragraph`, `Footnote` | Parsed text and cover image. The original EPUB file is not kept.       |
| Rig sessions     | `RigSession`                     | An Anthropic session id; the transcript itself is not stored here.     |
| Session          | cookie `__rig_session`           | Signed, `userId` only, 30 days.                                        |
| API token (iOS)  | device Keychain                  | See F8.                                                                |

### Sent to third parties

| Recipient | What                                                                                                                                              | When                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| PostHog   | User id, event name, work id and title, locators, ordinals, counts, lengths, page URL (minus `token`/`q`) and title; exceptions with stack traces | Only with `POSTHOG_PROJECT_API_KEY` |
| Resend    | Recipient email address, the sign-in link (raw token and any `redirectTo`)                                                                        | Only with `RESEND_API_KEY`          |
| Anthropic | Rig messages, on-screen and selected book text, mentioned notes, `search_shelf` results; web searches and fetches the agent chooses to make       | Only with `ANTHROPIC_API_KEY`       |
| Railway   | Hosts the database and receives all server logs (errors, and magic links if F4 applies)                                                           | Deployed environments               |

## What a real privacy policy would need to cover

1. That an email address is collected and why, and that it is kept after a
   sign-in link is merely requested.
2. Each processor above, what it receives, and where it processes it (PostHog
   defaults to US Cloud; `POSTHOG_HOST` can change that).
3. That using the Rig sends book text, the reader's questions and any
   mentioned notes to Anthropic, and that the agent can make web requests.
4. That book titles and reading progress are reported to analytics under a
   pseudonymous id, and whether a user can opt out.
5. Retention periods, and how to request deletion or a copy of one's data —
   neither exists yet.
6. Cookies: one strictly necessary session cookie, nothing else.
7. Uploaded books: that the text is stored, and that identical files are
   de-duplicated across accounts.

## Recommendations (not implemented)

1. Refuse to start, or refuse to log the link, when real auth is required and
   `RESEND_API_KEY` is unset (F4). Smallest change with the most effect.
2. Delete `MagicLinkToken` rows once consumed or expired (F3).
3. Add account deletion that also deletes the user's Anthropic sessions, and
   decide what happens to a shared `Work` when its first uploader leaves (F3).
4. Validate beacon properties per event name instead of forwarding them (F5).
5. Decide whether book titles belong in analytics at all; `workId` alone
   answers most of the same questions (F5).
6. Decide whether `web_fetch` is worth its exfiltration surface, and record
   the Anthropic data flow in `SECURITY.md` (F6).
7. Report a sanitized message rather than the raw error for Prisma errors (F7).
8. Publish an actual policy, and re-run this audit against it.
