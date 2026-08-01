# Font sources

`Caprasimo-Regular.ttf` — fetched once from Google's own font repository
(`https://github.com/google/fonts/raw/main/ofl/caprasimo/Caprasimo-Regular.ttf`,
2026-08-01) as the canonical, complete source to subset from. It's the same
256-glyph design Google serves via the `fonts.googleapis.com` CSS API
(Caprasimo has no arrow glyphs at any weight — the `←`/`→` SectionNav
buttons already fell back past Caprasimo to `system-ui`/`sans-serif` before
this change, and still do; subsetting doesn't remove that behavior, the
source font simply never had those glyphs).

Committed here as a one-time, human-auditable asset — not re-fetched at
build or runtime. `scripts/subsetCaprasimo.ts` reads this file and writes a
glyph-subsetted `.woff2` to `public/fonts/generated/` (gitignored, rebuilt
every `predev`/`prebuild`) containing only the codepoints actually used by
`app/domain/typography/displayStrings.ts`'s `DISPLAY_STRINGS`.

`OFL.txt` — the SIL Open Font License this font ships under, fetched
alongside for the same provenance reason.
