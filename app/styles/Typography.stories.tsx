import type { Meta, StoryObj } from "@storybook/react-vite";
import { DisplayText } from "~/components/DisplayText";

// No component backs this — it documents the type system itself, the way
// Organic's own foundations/type.html does. `font-reading` here is a raw
// Tailwind utility class, not an Organic component class: there is no
// `.reading` class in styles.css, because reading-body type is applied ad
// hoc wherever a passage renders (starting with #6's paragraph renderer),
// not through a shared component. This story is the check that the utility
// actually resolves to Fraunces — the amendment this ticket makes to Organic.
const meta = {
  title: "Foundations/Typography",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const HeadingBodyReading: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 640 }}>
      <div>
        <div className="text-xs uppercase tracking-wide text-[var(--color-accent)]">
          font-heading — Caprasimo
        </div>
        {/* Caprasimo is glyph-subsetted to exactly DISPLAY_STRINGS (#85), so
            this has to render real DisplayText, not arbitrary demo copy —
            anything else shows a patchwork of the subset's glyphs plus
            whatever the fallback face has for the rest. */}
        <h3>
          <DisplayText text="Reading Rig" />
        </h3>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wide text-[var(--color-accent)]">
          font-body — Figtree (the interface voice; also body's default)
        </div>
        <p className="font-body text-sm">
          Ch. 1 · §4 · 9 min left in section
        </p>
      </div>

      <div>
        <div className="mb-2 text-xs uppercase tracking-wide text-[var(--color-accent)]">
          font-reading — Fraunces (the book, and the commonplace book)
        </div>
        <p className="font-reading text-[17.5px] leading-[1.8]">
          It is as clear as noon-day, that man, by his industry, changes the
          forms of the materials furnished by Nature, in such a way as to
          make them useful to him. The form of wood, for instance, is
          altered, by making a table out of it. Yet, for all that, the table
          continues to be that common, every-day thing, wood.
        </p>
      </div>
    </div>
  ),
};
