# app/rig/tools

The agent's reading API: plain, read-only functions over Prisma (#25). Typed
inputs, no SDK types — nothing here knows whether it's called by a custom
tool-call loop or an MCP façade, so the transport can change later without
touching these.

`dispatchTool.ts` (#26) has had a live `search_shelf` case since the session
lifecycle shipped, but nothing told the agent the tool existed until
`agentConfig.ts`'s `buildSearchShelfTool()` declared it as a `custom_tool` —
that's the only piece that actually makes a handler here reachable.
`search_shelf` is wired this way now; `getPassage`/`getSurrounding`/
`listMyNotes` have live dispatch cases too but no `custom_tool` declaration
yet, so the agent can't call them until the same step happens for each.

## The handlers, in likely calling order

**Entry points** — don't require a `paragraphId` up front:

- `searchShelf(userId, workId, query, bookmarkGlobalOrdinal)` — text search
  within one work, bounded by the reader's bookmark. A paragraph past the
  bookmark is never a candidate row.
- `listMyNotes(userId, workId?)` — every margin note the user has kept,
  across the whole shelf or scoped to one work.

**Drill-in** — take a `paragraphId`, most likely one handed back by an entry
point above:

- `getPassage(userId, paragraphId)` — one paragraph, bookmark-checked.
- `getSurrounding(userId, paragraphId, before, after)` — that paragraph plus
  N before/after; the "after" side clips at the bookmark, "before" never
  needs its own check (anything earlier than an in-bookmark target already
  qualifies).

**Not yet buildable:**

- `getSourceExcerpt(userId, sourceId, query?)` — a typed stub. Throws: there's
  no `Source` model until M4 (#23) builds one.

## The bookmark boundary

"Nothing past your bookmark" is enforced in every handler that reads passage
text (`searchShelf`, `getPassage`, `getSurrounding`) — not just search. It's
a property of the query itself (the row is never fetched), never a filter
applied after the fact. `listMyNotes` is the one exception: an `Entry` only
ever exists because its anchor paragraph was already in view when it was
written, so there's nothing past the bookmark for it to leak.

## Tests

Run against a real SQLite database, not mocks — the first ticket in this
repo to do so. `globalSetupDb.ts` pushes the schema to one template file once
per `vitest run`; `testDb.ts` copies it per test file for isolation, and
`testFixtures.ts` holds the shared work/chapter/section/paragraph seeding
every handler test uses.

## Elsewhere

A `Thread`/`list_threads` handler briefly existed here and was removed —
the threads feature itself was dropped from the schema before this
directory's tools were finished, and the handler never should have shipped
against it.

An MCP façade (build plan, M5) may wrap these same functions as an
alternate transport someday; no ticket for it exists yet, so treat this
README — not an issue — as the source of truth on the handlers until one
does.
