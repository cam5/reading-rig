import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChapterSectionDivider } from "./ChapterSectionDivider";

const meta = {
  title: "Components/ChapterSectionDivider",
  component: ChapterSectionDivider,
  args: { chapterOrdinal: 1, sectionOrdinal: 1 },
  render: (args) => (
    <div style={{ maxWidth: 480 }}>
      <ChapterSectionDivider {...args} />
      <p className="font-reading text-[20px] leading-[1.6] opacity-60">
        Paragraph text would continue directly below the divider, same as any other row in the flow.
      </p>
    </div>
  ),
} satisfies Meta<typeof ChapterSectionDivider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FirstSection: Story = {};

export const LaterChapter: Story = {
  args: { chapterOrdinal: 12, sectionOrdinal: 3 },
};
