# Test gaps

A ranked list of the test-coverage gaps that remain after the PR that added
`onScreenExcerpt.test.ts`, `anchorContext.test.ts` and `pageTitle.test.ts`.
**That PR deliberately does not cover anything below.** It only covered the
three small pure domain modules that vitest already collects.

Scope note: `vitest.config.ts` only collects `app/domain/**`, `app/rig/**`,
`app/auth/**`, `app/*.server.test.ts` and `lib/**`. The config's own comment
says component and route tests should get their own project entry instead of
widening that list.

## 1. `app/domain/reading/handleReadAction.server.ts` (highest risk)

- **Why:** At 450 lines, this is the single intent dispatcher for every
  highlight, highlight+note, note and bookmark write the reading view makes,
  and it has no tests. A regression here silently loses or corrupts user data.
- **Approach:** Real SQLite through `createTestDb()` (`app/rig/tools/testDb.ts`)
  plus `testFixtures.ts`, the same way `searchMentionCandidates.server.test.ts`
  and the `app/rig/tools/*` tests do. Build `FormData` for each intent
  (`highlight`, `highlight-note`, `note`, `bookmark`), pass a stub
  `AnalyticsClient`, and assert on the rows written. Also cover the
  `Unknown intent` → 400 path and the `hasOwnProperty` guard (for example,
  `intent=constructor`).

## 2. Other DB-backed `.server` modules (same harness)

| File                                                | Why                                                                                       | Approach                                                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `app/domain/reading/fetchReadPageData.server.ts`    | Loader data for `read.tsx`, the main page                                                 | `createTestDb()` + fixture work; assert on the shape and the bookmark/progress fields                  |
| `app/domain/commonplace.server.ts`                  | Shelf-wide and single-entry commonplace queries. Only the pure `commonplace.ts` is tested | Seed entries across two works and two users; assert ordering, per-user scoping, and the not-found path |
| `app/domain/reading/assertWorkReadableBy.server.ts` | Authorisation gate: who may read which work                                               | Assert it throws for other users' works and returns for owned ones (`fetchOwnedWork` too)              |
| `app/domain/work/fetchShelf.server.ts`              | Home shelf query                                                                          | Seed works for two users; assert scoping and ordering                                                  |
| `app/rig/tools/shared.ts`                           | `fetchOwnedParagraph` / `resolveVisibleParagraph` ownership and visibility checks         | Covered indirectly by the tool tests. Direct tests would pin the bookmark-visibility rule              |
| `app/domain/api/**` schemas, `openapi.server.ts`    | API contract                                                                              | One snapshot or round-trip parse per schema                                                            |
| `app/rig/anthropicSessionClient.ts`                 | `rigUnavailableReason()` is pure and depends on the environment                           | Unit test it with stubbed `process.env`. Leave the client itself to integration                        |

## 3. Pure helpers in `app/components/*.ts`

`calloutPosition`, `floatingPosition`, `selectionHandlePosition`,
`tokenComposerCaret`, `tokenComposerMention` are pure geometry and string
logic. `tokenComposerEditing` and `tokenPill` touch the DOM.

- **Why:** These produce caret and selection placement bugs that users can
  see. Today no vitest project collects them.
- **Approach:** Add a separate vitest project entry for `app/components/**`
  instead of widening the domain include. Use `environment: "jsdom"` (or
  `happy-dom`) for the `tokenPill`/`tokenComposerEditing` DOM code. The
  geometry helpers can run in node.

## 4. Routes (`app/routes/**`)

- **Why:** The only coverage is `app/routes/apiV1.smoke.test.ts`. Loader and
  action glue in `read.tsx` (1258 lines), `api.v1.rig.tsx`,
  `api.v1.rig-sessions.tsx`, `auth.*` and `upload.tsx` is untested.
- **Approach:** Call the loaders and actions directly with a constructed
  `Request` against `createTestDb()`. Leave rendering to Storybook or
  Playwright.

## Not worth testing

`app/domain/typography/displayStrings.ts` and `fraunceLinks.ts` are constant
arrays with no logic.

## Known flaky test

`app/rig/dispatchTool.test.ts` › `list_my_notes` › "defaults to the whole
shelf" fails roughly 1 run in 5. It creates two entries back to back and
expects newest-first order, but both rows can share a `createdAt`
millisecond. To fix it, set explicit `createdAt` values in the fixture (or
give the query a deterministic tiebreaker).
