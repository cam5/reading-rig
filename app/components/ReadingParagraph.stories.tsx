import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReadingParagraph } from "./ReadingParagraph";

// The same four paragraphs as app/domain/epub/__fixtures__/capital-volume-i.epub's
// §4 — copied from the same source (design/Reading Rig.dc.html), not
// retyped, so this story is checking the same real text the ingest tests
// assert against.
const section4 = [
  {
    html: "A commodity appears, at first sight, a very trivial thing, and easily understood. Its analysis shows that it is, in reality, a very queer thing, abounding in metaphysical subtleties and theological niceties.",
    text: "A commodity appears, at first sight, a very trivial thing, and easily understood. Its analysis shows that it is, in reality, a very queer thing, abounding in metaphysical subtleties and theological niceties.",
  },
  {
    html: "So far as it is a value in use, there is nothing mysterious about it, whether we consider it from the point of view that by its properties it is capable of satisfying human wants, or from the point that those properties are the product of human labour.",
    text: "So far as it is a value in use, there is nothing mysterious about it, whether we consider it from the point of view that by its properties it is capable of satisfying human wants, or from the point that those properties are the product of human labour.",
  },
  {
    html: "It is as clear as noon-day, that man, by his industry, changes the forms of the materials furnished by Nature, in such a way as to make them useful to him. The form of wood, for instance, is altered, by making a table out of it. Yet, for all that, the table continues to be that common, every-day thing, wood.",
    text: "It is as clear as noon-day, that man, by his industry, changes the forms of the materials furnished by Nature, in such a way as to make them useful to him. The form of wood, for instance, is altered, by making a table out of it. Yet, for all that, the table continues to be that common, every-day thing, wood.",
  },
  {
    html: "But, so soon as it steps forth as a commodity, it is changed into something transcendent. It not only stands with its feet on the ground, but, in relation to all other commodities, it stands on its head, and evolves out of its wooden brain grotesque ideas, far more wonderful than table-turning ever was.",
    text: "But, so soon as it steps forth as a commodity, it is changed into something transcendent. It not only stands with its feet on the ground, but, in relation to all other commodities, it stands on its head, and evolves out of its wooden brain grotesque ideas, far more wonderful than table-turning ever was.",
  },
];

const meta = {
  title: "Components/ReadingParagraph",
  component: ReadingParagraph,
  args: { paragraph: section4[0] },
} satisfies Meta<typeof ReadingParagraph>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleParagraph: Story = {
  args: { paragraph: section4[2] },
};

// The Done-when bar: "§4 renders and looks like screen 1c" — same measure
// (660px), same four paragraphs, in reading order.
export const Section4: Story = {
  render: () => (
    <div className="max-w-reading">
      {section4.map((p, i) => (
        <ReadingParagraph key={i} paragraph={p} />
      ))}
    </div>
  ),
};

// 1c highlights this exact suffix of §4 ¶3 in accent-200 — reproduced here
// with a real, offset-computed highlight range (not a hand-placed <mark>),
// proving the crossing-boundary machinery renders, not just tests green.
export const WithHighlight: Story = {
  render: () => {
    const paragraph = section4[2];
    const start = paragraph.text.indexOf("The form of wood");
    return (
      <div className="max-w-reading">
        <ReadingParagraph
          paragraph={paragraph}
          highlights={[
            {
              id: "h1",
              start,
              end: paragraph.text.length,
              className: "bg-accent-200 rounded",
              order: 1,
            },
          ]}
        />
      </div>
    );
  },
};

// #48: overlapping highlights render as nested <mark>s with compounding,
// semi-transparent backgrounds instead of being rejected — the first real
// visual check that stacking looks right, not just that unit-test string
// assertions match.
export const StackedHighlights: Story = {
  render: () => {
    const paragraph = section4[2];
    const start = paragraph.text.indexOf("The form of wood");
    const overlapStart = paragraph.text.indexOf("wood, for instance, is altered");
    return (
      <div className="max-w-reading">
        <ReadingParagraph
          paragraph={paragraph}
          highlights={[
            {
              id: "older",
              start,
              end: overlapStart + "wood, for instance, is altered".length,
              className: "bg-[color-mix(in_srgb,var(--color-accent-2)_35%,transparent)]",
              order: 1,
            },
            {
              id: "newer",
              start: overlapStart,
              end: paragraph.text.length,
              className: "bg-[color-mix(in_srgb,var(--color-accent)_35%,transparent)]",
              order: 2,
            },
          ]}
        />
      </div>
    );
  },
};
