import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReadingParagraphSkeleton } from "./ReadingParagraphSkeleton";

const meta = {
  title: "Components/ReadingParagraphSkeleton",
  component: ReadingParagraphSkeleton,
  // 4 lines at the reading column's 31.5px leading — a typical body
  // paragraph's estimate, which is what a real skeleton stands at.
  args: { id: "skeleton-1", heightPx: 126 },
} satisfies Meta<typeof ReadingParagraphSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// What a reader who's scrolled ahead of the fetched content window
// actually sees — a few of these, back to back, until useContentWindow's
// fetch resolves and swaps each one for a real ReadingParagraph.
export const RunOfRows: Story = {
  render: () => (
    // Varying heights on purpose: each skeleton stands at its own
    // paragraph's estimated height, not a uniform block.
    <div className="flex max-w-reading flex-col gap-5">
      {[
        { id: "a", heightPx: 126 },
        { id: "b", heightPx: 252 },
        { id: "c", heightPx: 63 },
      ].map(({ id, heightPx }) => (
        <ReadingParagraphSkeleton key={id} id={id} heightPx={heightPx} />
      ))}
    </div>
  ),
};
