# Glossary

Terms this codebase uses with a specific meaning that isn't obvious from the
word alone. If you're reading a comment or variable name and it isn't here,
it's probably just English — add it here instead of re-explaining it in a
third place once someone asks a second time.

## The text tree

**Work** — one ingested book. `Work` → `Chapter` → `Section` → `Paragraph`,
the normalised tree an EPUB parses into (`app/domain/epub/parseEpub.ts`).
`Work.id` is content-addressed from the book's own OPF identifier, not
random, so re-ingesting the same file resolves to the same row.

**ordinal** vs **globalOrdinal** — a `Paragraph`'s `ordinal` is its position
*within its Section* (1-based); `globalOrdinal` is its position across the
*whole Work*. Locators (`§4 ¶3`) are built from `ordinal`; scroll/viewport
math (marginalia, the bookmark, reading progress) is built from
`globalOrdinal`, because it's the one number that's comparable across
section and chapter boundaries.

**locator** — the display string for a position or span, e.g. `§4 ¶3` or
`§4 ¶2–3`. Always *derived* at render time (`app/domain/locator.ts`) from a
Section's label and a Paragraph's ordinal, never stored — so a re-ingest
that renumbers a section can't leave a stale locator behind on an old note.

## Highlights and notes

**Highlight** vs **HighlightSpan** — a Highlight is the one thing the user
made (or the Rig made, on their behalf — see `hand`/`rig` below); a
HighlightSpan is its reach into *one* paragraph. A highlight spanning three
paragraphs is one `Highlight` row and three `HighlightSpan` rows.

**Entry** — a note. Anchors to one paragraph, coarser than a Highlight on
purpose — the precise excerpt it was written against (when there is one)
lives in `contextSnapshot`, not as a queryable offset. An Entry can stand
alone or be attached to a Highlight (`highlightId`) as a note *about* that
highlight.

**hand** vs **rig** — who/what made a Highlight or Entry. `hand` is you;
`rig` is the Reading Rig (the AI) acting through a posture. Colour-coded in
the design: sage for hand, terracotta for rig (see the README's "four
invariants").

**posture** — one of six modes you invoke the Rig in, not a chat: Interrogate,
Steelman, Connect, Close-read, Context, Recap. Each is a specific stance
toward the passage in view, not an open-ended conversation.

**contextSnapshot** — free-form JSON on an `Entry` capturing what was true
when it was written (today, just `{ excerpt }`; M3's Rig entries will carry
richer context in the same field). Captured at write time because that
context can't be truthfully reconstructed later from anything else.

**woven entry** — a Rig entry that's been incorporated into an existing hand
entry (`Entry.wovenIntoEntryId`), i.e. "woven into your note above." Buildable
now as a self-relation; nothing sets it until M3 builds the Rig side.

**RigSession** — a not-yet-built concept for one continuous conversation with
the Rig. `Entry.rigSessionId` is a plain nullable field reserving the shape
without inventing the table before M3 needs it.

## Reading and the margin

**bookmark** / **ReadingPosition** — where you left off in a Work. One row
per (user, work); writing it is always an upsert (`app/domain/reading/bookmark.ts`).

**marginalia** — the sidebar panel next to the reading column that shows
your current highlights and notes (component: `MarginaliaSidebar`). Not a
fixed list — it's scoped live to whatever's anchored within (or near) the
currently-visible scroll window via
`marginaliaOrdinalRange`/`isWithinMarginalia()` (`app/domain/paragraph/marginalia.ts`),
so it follows you down the page instead of showing the whole work's notes
at once. "Within marginalia" means "anchored to a paragraph currently in
view."

**commonplace book** — the notebook-style view of everything you've kept
(`/commonplace`), "the same artefact as the margin seen from the other
side" (README). A commonplace book is the old term for a personal
collection of copied-out passages and reflections — the product's framing
device, not a Reading Rig invention.

**scroll-settle** — the debounced moment (~400ms after scrolling stops) that
the app treats as "the reader has arrived somewhere," rather than reacting
to every scroll frame. Recomputes the bookmark, URL `?section=`, reading
progress, and marginalia's scope, all off one shared debounce
(`useBookmarkTracker`).

**virtualized window** — the slice of the work's paragraphs actually mounted
as real DOM at any moment (`useVirtualizedRows`), even though the whole
work's data is loaded client-side. Keeps a 2000-paragraph novel from ever
rendering as 2000 real DOM nodes at once.

## Design references

**Screens** (1c, 2b, 2c, 3a, 3b, …) — IDs from the source design canvas
(`design/Reading Rig.dc.html`), used in code comments and commit messages
to point at a specific mock rather than re-describing it. See the README's
"Design" section for the current ID → screen mapping.
