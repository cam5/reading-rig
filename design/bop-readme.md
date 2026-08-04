# Bop design system

Bop is flat, outlined and a little chunky: a pale sky-blue ground behind
mint-white "screen" surfaces, thick ink outlines on every shape, mint-teal
and gold accents, Baloo 2 display headings over Figtree, radii that grow
from a rounded square into a fully rounded card. The aesthetic register is
a friendly handheld console sitting in a pale sky — flat vector
illustration, not any one character's specific design. No literal clouds,
grass or character iconography belongs in product chrome; the shapes and
line weight carry the reference on their own.

## How to use this

- Take every color, font, spacing, radius and shadow from `app/styles/bop.css`'s `@theme` block (`var(--color-*)`, `var(--font-*)`, `var(--space-*)`, `var(--radius-*)`, `var(--shadow-*)`, `var(--stroke)`). Never hard-code a hex, a font name or a px value the tokens already carry.
- Build with the classes already defined in `bop.css` (`.btn`, `.card`, `.tag`, `.seg`, `.input`, `.dialog`, `.table`, `.nav`) rather than inventing parallel ones.
- To change the look, edit the tokens at the top of `bop.css` — every component reads from them, so nothing else needs to change in step.

## Direction

Left-aligned, asymmetric layouts, same as before. Lean into chunky rounded
rectangles — over-rounded cards, rounded-square buttons rather than
stretched pills. Every surface gets a thick ink outline (`var(--stroke)`,
2.5px) and a solid offset "stamp" shadow instead of a blurred one — press
states flatten the offset to zero, like the shape is being pushed in.

## Color

A pale sky ground (`--color-bg` `#cbeeff`) with mint-white "screen"
surfaces (`--color-surface` `#e9faf2`) and dark charcoal-navy ink
(`--color-text` `#0c222d`, doubling as the outline color everywhere).
Two coloured roles plus a third:

- `--color-accent` (mint-teal, `#10a68b`) — **the machine's voice and the live thing.** Rig turns, agent kickers, running-state dots.
- `--color-accent-2` (gold, `#b48704`) — **your hand and your shelf.** Anything you wrote or saved yourself.
- `--color-danger` (coral-red, `#e65c52`) — **new in Bop.** Error states only; Organic never had a real red to reach for.

Nothing else is coloured. Each role carries a 100–900 tonal ramp generated
in OKLCH on one shared lightness scale, so the same step of any ramp
carries the same visual weight. Use light steps (100–300) for tinted
fills, `-700` for text/links on the page ground (the base `-500` step
doesn't clear 4.5:1 against `--color-bg` — checked, not eyeballed), and
`--color-text` itself — not a light color — as the label on a solid
`-500` fill; ink-on-500 clears AA on all three roles and doubles as
another place the outline motif shows up.

## Type

Baloo 2 for headings over Figtree for body text (`--font-heading` /
`--font-body`); Literata (`--font-reading`) still carries the book itself
and commonplace entries — unchanged, self-hosted with its own CLS
engineering (see `app/styles/fonts.css`), and orthogonal to this redesign.

## Icons

Lucide (https://lucide.dev), stroke-width 3 — up from Organic's 2.75, for
the chunkier line weight. Nothing renders one yet; this is guidance for
whenever one gets added.

## Interaction states

Buttons and cards use the "stamp" shadow, not a color-darken: `:hover`
lifts the element 1px toward its own shadow and grows it slightly; `:active`
pushes the element onto the shadow and flattens it to zero. Keyboard focus
is still `:focus-visible { outline: 2px solid var(--color-accent-700); outline-offset: 2px; }`
— never the browser default ring.

## Components

| Class | What it is |
| --- | --- |
| `.btn` with `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-icon`, `.btn-block` | Actions — primary is a solid mint-teal fill with an ink label |
| `.tag` with `.tag-accent`, `.tag-accent-2`, `.tag-neutral`, `.tag-outline`, `.tag-danger` | Small outlined labels tinted from the ramps |
| `.field` + `label`, `.input`, `.radio` + `.dot`, `.seg` + `.seg-opt` | Form fields and choices, all outlined |
| `.card` with `.card-kicker`, `.card-title`, `.card-body`, `.card-meta`; `.elev-sm/md/lg` | Outlined, stamp-shadowed content surfaces |
| `.nav` + `.nav-brand` | The header bar — now with an ink bottom border |
| `.table` | Data tables with an ink header rule |
| `.dialog-backdrop` + `.dialog` (+ `.dialog-title/-body/-actions`) | A modal at the top elevation |
| `.hr` | An ink-colored rule — still prefer whitespace where you can |

## Do

- Outline everything: `var(--stroke)` solid `var(--color-text)` on every card, button, input, tag border and dialog.
- Keep buttons and cards as chunky rounded rectangles (`--radius-md` / `--radius-lg`), not pills — pills were Organic's move, not Bop's.
- Use the stamp shadow + press-in interaction on anything clickable.
- Reach for gold (`--color-accent-2`) as a genuine second voice for anything the reader made themselves, not just a highlight.

## Don't

- Do not draw soft blurred shadows — every shadow here is a solid offset.
- Do not stretch a button into a pill; `.btn-icon` is a rounded square, not a circle.
- Do not introduce a fourth coloured role without a real semantic reason — `--color-danger` exists because errors had nowhere real to live, not as a precedent for adding more.
- Do not touch `--font-body` or `--font-reading` for aesthetic reasons — both carry real CLS/perf work unrelated to this system's look.
