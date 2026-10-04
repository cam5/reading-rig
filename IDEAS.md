# Improvement ideas

Generated 2026-10-04 from a read-only survey of `main` at `98ab6df`. Nothing
here is implemented; each idea is a candidate, with the evidence that prompted
it and a rough size.

How to read the ratings:

- **Impact** — how much a reader, or whoever is on call, would notice.
- **Effort** — S is an afternoon, M is a few days, L is a week or more.
- **Risk** — the chance that doing it breaks something that works today.

Every `path:line` reference was checked against `98ab6df`. Line numbers will
drift as the files change.

What was run: `npm run typecheck` and `npm run format:check` (both pass),
`npm outdated`, and a `TODO|FIXME|HACK|XXX` grep over `app`, `lib`, `scripts`
and `ios/Sources` (no matches). `npm test` was not run, so test-coverage
ideas below come from file listings, not from a coverage report.

## Summary

| #   | Idea                                                          | Area                 | Impact | Effort | Risk   |
| --- | ------------------------------------------------------------- | -------------------- | ------ | ------ | ------ |
| 1   | Let a reader delete or edit a highlight or note               | Reader UX            | High   | M      | Medium |
| 2   | Paginate the commonplace book                                 | Reader UX            | Medium | M      | Low    |
| 3   | Cap `search_shelf` results                                    | Rig / agent          | Medium | S      | Low    |
| 4   | Move the Rig off `claude-opus-4-7` and update the SDK         | Rig / agent          | Medium | S      | Medium |
| 5   | Scheduled backups for the SQLite volume                       | Data and durability  | High   | M      | Low    |
| 6   | Prune expired magic-link tokens                               | Data and durability  | Low    | S      | Low    |
| 7   | Fail CI when `openapi/api-v1.json` is stale                   | Testing and CI       | Medium | S      | Low    |
| 8   | Unit-test `handleReadAction.server.ts`                        | Testing and CI       | Medium | M      | Low    |
| 9   | Bring the pure helpers in `app/components` under `npm test`   | Testing and CI       | Medium | M      | Low    |
| 10  | Add dependency update automation, and pin `chromaui/action`   | Testing and CI       | Medium | S      | Low    |
| 11  | Re-baseline the Lighthouse time budgets                       | Performance and a11y | Medium | S      | Low    |
| 12  | Turn Storybook a11y checks from `todo` to `error`             | Performance and a11y | Medium | M      | Low    |
| 13  | Send security response headers                                | Performance and a11y | Medium | M      | Medium |
| 14  | Build the iOS app target in CI and test `RigSSE`/`InlineHTML` | iOS                  | Medium | M      | Low    |

If only three get done, I would pick 5, 1 and 7: 5 protects data nothing else
protects, 1 is the largest gap a reader would hit, and 7 is an afternoon's
work that removes a silent failure mode.

## Reader UX

### 1. Let a reader delete or edit a highlight or note

**Problem.** A highlight or note, once saved, is permanent. A reader who
mis-drags a selection or makes a typo in a note has no way to fix it.

**Evidence.**

- `app/domain/reading/handleReadAction.server.ts:410` — the read action's
  handler table has four intents (`highlight`, `highlight-note`, `note`,
  `bookmark`). All four create or upsert.
- A search for Prisma `.delete(` and `.deleteMany(` across `app/`, `scripts/`
  and `prisma/seed.ts` finds no call outside tests.
- `prisma/schema.prisma:319` and `prisma/schema.prisma:331` — the schema
  already expects deletion: `Entry.highlightId` and `Entry.wovenIntoEntryId`
  are both `onDelete: SetNull`.

**Approach.** Add `delete-highlight`, `delete-note` and `edit-note` intents to
the same handler table, each checking that `userId` matches the row's author.
Surface them in `MarginaliaSidebar` and on a highlight's own popover. The
optimistic-save path from PR #182 would need a matching optimistic removal.
Mirror the intents in `/api/v1/read/{workId}` so the iOS client gets them too.

**Effort** M. **Impact** High. **Risk** Medium: it is the first destructive
write in the app, so the ownership check and the optimistic rollback both need
tests.

**Related.** PR #182 (optimistic saves), PR #197 (open, touches the margin).

### 2. Paginate the commonplace book

**Problem.** The commonplace page and its API twin load every entry the reader
has ever written, across every work, on each request.

**Evidence.**

- `app/domain/commonplace.server.ts:44` — `db.entry.findMany` with no `take`
  or cursor.
- `app/routes/commonplace.tsx:24` and `app/routes/api.v1.commonplace.tsx:22`
  — both call it directly.

**Approach.** Cursor-paginate on `(createdAt, id)`, keeping the selected
`?entry=` in the first page. The page route can use the same windowing the
reading column already has; the API gets `cursor` and `limit` parameters and a
`nextCursor` field in its zod schema.

**Effort** M. **Impact** Medium, growing with use: invisible at tens of
entries, a slow page and a large iOS payload at thousands. **Risk** Low.

**Related.** #118 asks for the same thing for the Rig session picker.

## Rig / agent

### 3. Cap `search_shelf` results

**Problem.** The Rig's one custom tool returns every matching paragraph up to
the bookmark. A query for a common word in a long book puts hundreds of full
paragraphs into the agent's context, which costs tokens and time on every
later turn of that session.

**Evidence.**

- `app/rig/tools/searchShelf.ts:35` — `findMany` with `text: { contains }` and
  no `take`.
- `app/rig/agentConfig.ts:96` — the tool description tells the agent to call
  it on its own initiative, so the reader does not control how often it runs.

**Approach.** Add a `take` (20 to 30), and return the total match count
alongside the passages so the agent can say "40 more matches" and narrow its
query. Update the tool description to mention the cap. This stays inside the
read-only, custom-tool design.

**Effort** S. **Impact** Medium. **Risk** Low. The agent config changes, so
`scripts/setup-agent.ts` will bump the agent version on the next deploy.

### 4. Move the Rig off `claude-opus-4-7` and update the SDK

**Problem.** The agent's model is pinned to an Opus release that has since
been superseded, and the SDK is sixteen minor versions behind.

**Evidence.**

- `app/rig/agentConfig.ts:15` — `AGENT_MODEL` is `"claude-opus-4-7"`. The
  comment above it says the intent is "always Opus", not this particular
  version.
- `package.json:34` — `@anthropic-ai/sdk` is `^0.115.0`. `npm outdated`
  reports 0.131.0 as latest. Because the package is pre-1.0, the caret range
  will never pick up a newer minor on its own.

**Approach.** Update the SDK first, on its own, and let `npm run typecheck`
and the `app/rig` tests find any changes to the Managed Agents beta types.
Then change the model ID in a second PR and read a few real sessions before
and after, since the system prompt was tuned against 4.7.

**Effort** S. **Impact** Medium. **Risk** Medium: beta types may have moved,
and a model change alters the Rig's voice.

## Data and durability

### 5. Scheduled backups for the SQLite volume

**Problem.** Every highlight, note and bookmark lives in one SQLite file on
one Railway volume. Nothing copies it anywhere on a schedule.

**Evidence.**

- `app/db.server.ts:6` — one adapter over `DATABASE_URL`, with nothing around
  it.
- `RUNBOOK.md:81` — the only snapshot procedure is a manual copy taken just
  before a hand repair, and step 4 of the same list deletes it afterwards.
- `scripts/release.ts:96` — mentions "any future restore-from-backup
  scenario", which is the only place a backup is mentioned at all.
- No file in `scripts/` or `.github/workflows/` takes a backup.

**Approach.** The smallest version is a scheduled job that runs SQLite's
online backup (`VACUUM INTO` or better-sqlite3's `.backup()`) and uploads the
result to object storage, plus a RUNBOOK section on restoring. Litestream is
the fuller option if point-in-time recovery matters. Either way, test a
restore once; an untested backup is not worth much.

**Effort** M. **Impact** High. **Risk** Low, since it only reads.

**Related.** #145 is about writes not surviving on staging-qa's volume. This
is the separate question of what happens when a volume that does persist is
lost or corrupted.

### 6. Prune expired magic-link tokens

**Problem.** Each sign-in request adds a `MagicLinkToken` row and nothing
removes it.

**Evidence.**

- `app/magicLink.server.ts:23` — `createMagicLinkToken` inserts a row with a
  15-minute expiry (`app/magicLink.server.ts:4`).
- No `deleteMany` exists anywhere in the app (see idea 1).

**Approach.** In `createMagicLinkToken`, also delete rows whose `expiresAt` is
more than a day old. This follows the pattern `rateLimit.server.ts` already
uses, where cleanup rides on traffic instead of a timer.

**Effort** S. **Impact** Low: the rows are small and hold only hashes, but the
table grows without bound and holds email addresses longer than needed.
**Risk** Low.

## Testing and CI

### 7. Fail CI when `openapi/api-v1.json` is stale

**Problem.** The committed OpenAPI document is generated by hand. If a zod
schema changes and nobody runs `npm run generate:openapi`, the iOS client is
generated from the old contract and nothing reports it.

**Evidence.**

- `scripts/generateOpenApi.ts:14` — writes the file, with no check mode.
- `.github/workflows/ci.yml:37` — CI already has this kind of guard for
  Prisma (`migrate diff --exit-code`), but none for OpenAPI.
- `.github/workflows/ios.yml:32` — the comment says a stale document "would
  only surface here". That is true only when the staleness breaks Swift
  compilation; an added optional field or a changed description compiles
  fine.
- `app/routes/apiV1.smoke.test.ts:173` — the smoke test checks the live
  document's version and one path, not that it equals the committed file.

**Approach.** Add a CI step after `npm run db:generate`:
`npm run generate:openapi && git diff --exit-code openapi/`.

**Effort** S. **Impact** Medium. **Risk** Low.

**Related.** #192, #196.

### 8. Unit-test `handleReadAction.server.ts`

**Problem.** The file every highlight, note and bookmark write goes through
has no test of its own.

**Evidence.**

- `app/domain/reading/handleReadAction.server.ts` is 450 lines with no
  sibling `.test.ts`. It is the second-largest untested file in `app/domain`,
  after `app/domain/api/openapi.server.ts`.
- `app/routes/apiV1.smoke.test.ts:267` and
  `app/routes/apiV1.smoke.test.ts:287` cover the `bookmark` and `highlight`
  intents on the happy path. The `note` and `highlight-note` intents, and the
  error branches at `app/domain/reading/handleReadAction.server.ts:217`,
  `:297`, `:367` and `:447`, are not exercised.

**Approach.** Use the real-SQLite harness the Rig tool tests already have
(`app/rig/tools/testDb.ts`). Cover each intent, the cross-user case (a
paragraph in a work the user cannot read), and the multi-paragraph highlight
span maths.

**Effort** M. **Impact** Medium. **Risk** Low.

**Related.** #196 would change these error responses to JSON; tests written
first would make that change safer. Idea 1 adds intents to the same file.

### 9. Bring the pure helpers in `app/components` under `npm test`

**Problem.** `app/components` holds about 1,900 lines of non-JSX logic in
thirteen `.ts` files, and the test config does not look there.

**Evidence.**

- `vitest.config.ts:43` — the include list covers `app/domain`, `app/rig`,
  `app/auth`, top-level `app/*.server.test.ts` and `lib`.
- No file in `app/components` has a test. Some of what is there is plain
  arithmetic with no DOM: `app/components/floatingPosition.ts`,
  `app/components/calloutPosition.ts`,
  `app/components/selectionHandlePosition.ts`, and
  `truncateForPillLabel` at `app/components/tokenPill.ts:8`.
- #158 and #131 are open bugs in this area (autocomplete closing on a space,
  a popup clipped off-screen).

**Approach.** Two steps. First, add `app/components/**/*.test.ts` to the
include list and test the DOM-free helpers; that keeps `npm test` fast and
browserless, which the config's own comment asks for. Second, and only if it
proves worth it, move the pure parts of `tokenComposerEditing.ts` and
`useVirtualizedRows.ts` into `app/domain` so they can be tested without jsdom.

**Effort** M. **Impact** Medium. **Risk** Low.

### 10. Add dependency update automation, and pin `chromaui/action`

**Problem.** Dependencies are updated by hand, and one CI action floats on
`@latest`.

**Evidence.**

- `.github/` contains only `workflows/`; there is no Dependabot or Renovate
  config.
- `npm outdated` on 2026-10-04 lists 32 packages behind, including
  `react-router` (8.3.0 against 8.4.0), `prisma` and `zod`.
- `.github/workflows/chromatic.yml:51` — `uses: chromaui/action@latest`. Every
  other action in the repo is pinned to a major version.
- `.github/workflows/chromatic.yml:35` — the comment says the
  `CHROMATIC_PROJECT_TOKEN` secret "does not exist yet", but the issue that
  tracked adding it (#31) is closed. Either the comment or the secret is out
  of date.

**Approach.** A `dependabot.yml` covering `npm` and `github-actions`, weekly,
with minor and patch updates grouped into one PR. Pin `chromaui/action` to a
major version. Check whether the Chromatic secret exists and fix the comment
to match.

**Effort** S. **Impact** Medium. **Risk** Low; each update PR still runs CI
and gets a Railway preview.

## Performance and a11y

### 11. Re-baseline the Lighthouse time budgets

**Problem.** The reason given for the loose LCP and FCP ceilings no longer
holds, so they are looser than they need to be.

**Evidence.**

- `lighthouserc.cjs:95` — says LCP is dominated by `styles/organic.css`
  importing Google Fonts, and that a tight budget would fail every PR until
  the fonts are self-hosted.
- `app/app.css:3` and `app/app.css:10` — the fonts are self-hosted now
  (`@import "./styles/fonts.css"`, with a comment citing #85).
- `lighthouserc.cjs:187` and `lighthouserc.cjs:224` — the ceilings are still
  5000 ms and 7000 ms, against observed medians of 2.9 s and 5.2 s that were
  measured with the Google Fonts chain in place.
- `lighthouserc.cjs:197` — refers to #64 as pending work; #64 is closed.

**Approach.** Take the medians from the last several `main` runs of the
Lighthouse workflow (the `lighthouse-reports` artifacts), rewrite the
"observed medians" table, and set the time ceilings to those medians plus
headroom for runner variance. Remove the stale Google Fonts rationale.

**Effort** S. **Impact** Medium: a real LCP regression of a second or two
would pass today. **Risk** Low, with some chance of a flaky check if the new
ceilings are set too tight.

### 12. Turn Storybook a11y checks from `todo` to `error`

**Problem.** The a11y addon is installed, but its findings are advisory, and
several interactive components have no story for it to check.

**Evidence.**

- `.storybook/preview.tsx:56` — `a11y: { test: "todo" }`, which reports
  violations in the Storybook UI and fails nothing.
- Ten components have no sibling `.stories.tsx`. The two that matter most are
  `app/components/SelectionHighlighter.tsx` (404 lines) and
  `app/components/RigLivePanel.tsx` (254 lines); `FootnoteMarker.tsx` and
  `RigMessageMarkdown.tsx` are also on the list.

**Approach.** Fix or explicitly waive the current violations story by story,
then switch to `"error"`. Add stories for the four components named above.
Enforcing this in CI needs a story test runner, which `vitest.config.ts`
deliberately declined for `npm test`; a separate CI job would keep that
decision intact.

**Effort** M. **Impact** Medium. **Risk** Low.

**Related.** PR #213 (open) adds a `jsx-a11y` lint pass. That checks source;
this checks rendered output, including contrast. They complement each other.

### 13. Send security response headers

**Problem.** The app sets no security headers on its HTML responses.

**Evidence.**

- A case-insensitive search of `app/` for `content-security-policy`,
  `x-frame-options`, `strict-transport`, `referrer-policy` and
  `x-content-type` finds nothing.
- `app/entry.server.tsx:71` — the only header the document response sets is
  `Content-Type`.
- `SECURITY.md` covers ingest sanitising, auth, the agent's tool surface,
  secrets and deploy, and does not mention response headers.

**Approach.** Start with the ones that cannot break anything:
`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`
and HSTS in production. Then add a Content-Security-Policy in report-only
mode. React Router's document includes inline hydration scripts, so the policy
needs a nonce for those; report-only shows what would break before anything
does.

**Effort** M. **Impact** Medium: `sanitizeHtml.ts` is the only defence against
script injection from an uploaded EPUB, and a CSP would be a second one.
**Risk** Medium for the enforcing CSP, low for the rest.

## iOS

### 14. Build the iOS app target in CI and test `RigSSE` and `InlineHTML`

**Problem.** CI proves the Swift package compiles and that one middleware
works. It does not build the app, and the two hand-written parsers have no
tests.

**Evidence.**

- `.github/workflows/ios.yml:36` — the job's only step is `swift test`.
- `ios/Tests/ReadingRigKitTests/BearerAuthMiddlewareTests.swift` is the only
  test file, at 43 lines against about 1,550 lines of source.
- `ios/README.md:117` — "Not yet run on an actual Simulator/device"; the app
  target in `ios/project.yml` has been resolved but never built.
- `ios/Sources/ReadingRigKit/RigSSE.swift:40` is a hand-rolled SSE parser and
  `ios/Sources/ReadingRigUI/InlineHTML.swift` is a hand-rolled HTML-to-
  `AttributedString` converter. Both take text in and give structured values
  out, which makes them easy to test.
- Commit `1727b6f` fixed a codesign failure that only an Xcode build showed.

**Approach.** Add tests for `RigSSE` (multi-line `data:` fields, events split
across chunks, comment lines) and `InlineHTML` (nested `<em>`/`<strong>`,
footnote markers, entities). Add a second CI step that runs `xcodegen` and
`xcodebuild build` for a simulator destination; the macOS runner has the
simulator runtime the local machine lacked.

**Effort** M. **Impact** Medium. **Risk** Low; macOS runner minutes cost more,
but the workflow is already path-filtered.

**Related.** PR #211 (open) fixes a font-loading bug that a build-and-launch
check might have caught. The README's other listed gaps (iOS drag-to-select,
optimistic UI, Rig chat parity) are known and are not repeated here.

## Not proposed

These were looked at and left alone, because they are deliberate decisions or
are already tracked.

- **The hand-highlight colour.** Literal `#FFCC00` at 30% is intentional. It is
  not a design-token miss.
- **Giving the Rig write access, or moving its tools to MCP.** The agent stays
  read-only with custom tools (`app/rig/agentConfig.ts:49`); idea 3 works
  within that.
- **A Storybook browser test runner inside `npm test`.** `vitest.config.ts`
  explains why not. Idea 12 suggests a separate job.
- **A database check in `/healthz`.** `app/routes/healthz.tsx:3` says it is
  deliberately DB-free.
- **A shared or durable rate limiter.** `app/auth/rateLimit.server.ts:1`
  explains why in-process is enough for one container.
- **Non-JSON `/api/v1` error bodies** — #196.
- **Rig reconnect behaviour** (`app/rig/useRigLiveSession.ts:42`) — #109.
- **Rig session picker labels and pagination** — #120, #118.
- **EPUB images and other dropped block content; footnote presentation** —
  #139, #138.
- **Composer bugs** — #131, #157, #158.
- **staging-qa volume durability and Railway variable sync** — #145, #113.
- **Paged-mode hook cost in scroll mode** — PR #214.
- **README and API/testing docs; roadmap drift** — PR #216, PR #217. Both add
  a `docs/` directory. If they merge first, this file could move there.
