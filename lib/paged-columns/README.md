# paged-columns

Paginate arbitrary flowing HTML content — turn a scrolling column of
content into fixed-size "pages" the reader flips between — using CSS
multi-column layout, with navigation driven by real browser measurement
instead of a pixel/line-height estimate. Framework-agnostic math
(`columnMath.ts`), one React hook (`usePagedColumns`), one nav-controls
component. No knowledge of paragraphs, books, or any particular content
model — it takes a list of generic "items" (a stable id plus a rough size
estimate) and hands back which page is showing, which items are on it, and
how to turn pages.

## Why this exists

The obvious way to build "pages" out of a scrolling column is: measure the
viewport, compute how many pixels of content fit, clip a `translateY`'d
window over the continuous flow, and step by that many pixels per page.
That was this package's first implementation. It worked in headless
Chromium testing and broke in real Chrome: the height-per-page number was
computed once from a sampled paragraph's line height, and the browser's
actual rendered line boxes didn't always match that sampled value to the
sub-pixel (font-load timing, sub-pixel rounding differences between
`Range.getClientRects()` and the frame it was being compared against). The
result was a page boundary that occasionally clipped straight through the
middle of a line's glyphs instead of landing between two lines — and
because the whole scheme was built on an assumed scalar with no
verification step, there was no way to detect or correct it after the
fact.

CSS multi-column fragmentation doesn't have this problem, because it isn't
a guess. The CSS Fragmentation spec guarantees an inline formatting
context never breaks a line across a column boundary — "a page boundary
always falls between two lines" is a browser guarantee here, not something
this package predicts and occasionally gets wrong. [Dave
Cramer's write-up](https://dauwhe.github.io/reflow/) (CSS WG, EPUB) is
good background reading — multi-column really is the real-world technique
digital reading systems use for this, though the spec itself, per that
piece, "was never designed for this" and results are "never exactly the
same everywhere" across browsers/engines. Treat exact cross-browser
line-count agreement as a nice-to-have, not a guarantee; small per-browser
CSS overrides are a normal cost of this technique, not a sign it's the
wrong one.

## The mechanic

Two nested elements, `frameRef` and `columnsRef` (both returned by
`usePagedColumns`, along with the inline styles to put on them):

```
<div ref={containerRef} style={{ /* however much height layout leaves you */ }}>
  <div ref={frameRef} style={frameStyle}>       {/* fixed width/height, overflow: hidden */}
    <div ref={columnsRef} style={columnsStyle}> {/* column-width, column-fill: auto, translateX */}
      {/* mounted items render here as ordinary block content */}
    </div>
  </div>
</div>
```

- **The frame** is a fixed-`columnWidthPx`-wide, `overflow: hidden` window
  — the one page's worth of content the reader can actually see.
- **The columns element** declares `column-width: columnWidthPx` and
  `column-fill: auto` (fills column 1 completely before starting column
  2 — this is what makes "page 1, then page 2, then page 3" the fill
  order rather than balancing content evenly across however many columns
  fit, which is the wrong fill mode for pagination). It sets no `width` of
  its own, so its nominal box is exactly the frame's width — one column.
  Content needing more columns than that nominal box accommodates doesn't
  refuse or wrap; CSS multi-column renders those columns anyway, extending
  rightward past the box's own edge. That's not a hack this package
  invented, it's a plain consequence of `column-count: auto` sizing every
  column (including the ones beyond what the nominal box shows) from the
  same single `column-width` value. The frame's `overflow: hidden` turns
  that overflow into "only one column visible at a time"; `translateX` on
  the columns element picks _which_ one.
- Because every column — including the overflowing ones — is sized from
  that one shared `column-width`, the pixel distance between adjacent
  columns is exactly `columnWidthPx + columnGapPx`, uniformly, for the
  whole flow. That uniformity is what makes measurement exact rather than
  approximate (see below) — it's the one fact everything else here leans
  on.

## Real measurement, not scalar arithmetic

"Which page is this item on" is answered by reading the browser's own
layout after a mount, never by computing where it "should" be:

1. Mount a bounded window of items (`estimateMountWindow`/
   `growMountWindow` — see below) into the columns element.
2. For each mounted item's element, call `getClientRects()`. A normal item
   returns one rect. An item taller than a page — a long, unbreakable
   block — returns one rect _per column it was fragmented across_; this is
   the standard, specified way to detect column fragmentation of an
   element from script, and it's what makes "a paragraph taller than one
   page just continues onto the next page" fall out for free rather than
   needing a special case.
3. Convert each rect's `left` into a column index by comparing it against
   the _columns element's own_ `getBoundingClientRect().left` — not the
   frame's, not the viewport's. Both numbers are read after whatever
   `translateX` is currently applied, so the transform cancels out of the
   subtraction identically no matter its value. That's what lets this
   package skip the "reset the transform to zero, measure, restore it"
   dance a naive implementation would reach for: a fragment's offset
   relative to its own (possibly translated) container is already the
   transform-independent answer. Dividing that offset by
   `columnWidthPx + columnGapPx` (`columnIndexForOffset`) is then exact,
   not approximate, because every column is that same width.
4. Vertical position (`topPx`/`bottomPx` on `VisibleItem`) needs none of
   this — `translateX` never moves anything vertically, so an item
   fragment's position relative to the frame's own top edge is valid
   regardless of which page is currently showing.

Page-turn navigation (`goToNextPage`/`goToPreviousPage`) is just: find the
mounted fragment one column index away from the current one, in flow
order. If nothing mounted answers that yet, grow the mount window by one
more guessed page's worth (`growMountWindow`) and retry once the newly
mounted content has actually been laid out — a real, bounded
grow-and-retry loop, not a wait for a number to be "right."

## Where the estimate still lives, and why that's fine

`estimateMountWindow`/`growMountWindow` take a caller-supplied "about how
big is this item" guess per item. That number is _only_ ever used to
decide how much content to hand the browser before real layout exists to
measure against — never to decide where a page boundary falls. Being
wrong by some margin just means one extra grow-and-retry round trip, not a
misrendered page. This is the load-bearing distinction the whole package
is built around: an estimate sizes the mount window; a real measurement
answers every question about where anything actually is.

## Page identity is an anchor item, not a number

There is no persisted, or even ephemeral-but-numbered, "page 7 of 40"
concept anywhere in this package. The only state that means anything
across a re-render, a resize, or a mount-window change is _which item's
fragment is currently flush with the frame's left edge_ — an id (plus,
for an item spanning multiple columns, which of its own fragments). A
resize or font-size change that reflows the whole document doesn't need
special-cased "reanchor" logic as a result: the same item id still means
something after a reflow (which fragment of it does not, so that resets to
its first), where a raw page number would not.

## Atomic items: `break-inside`/`break-after`

An item that must never be split across a column boundary (a short heading
glued to whatever follows it, say) needs `break-inside: avoid-column` set
in its own CSS — and, to stop it from being orphaned alone at the bottom
of a column with its following content pushed to the next one,
`break-after: avoid-column` too. Do **not** put `break-inside: avoid` on
an item that's allowed to span multiple pages (a long paragraph) — that
would force the whole item into a single column no matter how tall it is,
defeating the "a too-tall item just continues onto the next page" behavior
this package otherwise gets for free.

Browser support for `break-after` in a multi-column (not just paged-media)
context is inconsistent as of this writing — solid in Chromium, historically
absent in Firefox and Safari. Worth using regardless (Chromium users get
the correct behavior, everyone else degrades to "occasionally orphaned,"
not "broken"), but not a cross-browser guarantee.

## What's deliberately not here

No animation. `usePagedColumns` gives you an instant page swap
(`translateX` with no transition); a page-turn/curl animation is a
presentation concern for whatever consumes this package, layered on top of
`columnsStyle`/`goToNextPage`/`goToPreviousPage`, not something this
package's own measurement logic needs to know about.

No opinion on styling, fonts, or content model. `PagedColumnsItem` is
just `{ id: string; estimatedSizePx: number }`; render whatever you want
for each mounted id.
