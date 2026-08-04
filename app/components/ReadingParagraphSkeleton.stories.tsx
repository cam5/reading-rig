import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReadingParagraphSkeleton } from "./ReadingParagraphSkeleton";

const meta = {
  title: "Components/ReadingParagraphSkeleton",
  component: ReadingParagraphSkeleton,
  args: { id: "skeleton-1" },
} satisfies Meta<typeof ReadingParagraphSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// What a reader who's scrolled ahead of the fetched content window
// actually sees — a few of these, back to back, until useContentWindow's
// fetch resolves and swaps each one for a real ReadingParagraph.
export const RunOfRows: Story = {
  render: () => (
    <div className="max-w-[660px]">
      {["a", "b", "c"].map((id) => (
        <ReadingParagraphSkeleton key={id} id={id} />
      ))}
    </div>
  ),
};
