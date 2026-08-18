import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReadingRail } from "./ReadingRail";

const meta = {
  title: "Components/ReadingRail",
  component: ReadingRail,
  args: {
    workTitle: "Marx | Capital Vol. 1",
    progressPercent: 5,
    timeLeft: "14h 33m left",
    onPreviousSection: () => {},
    onNextSection: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ height: 500, background: "var(--color-bg)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReadingRail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const JustStarted: Story = {
  args: { progressPercent: 0, timeLeft: "11h 45m left" },
  render: (args) => <ReadingRail {...args} onPreviousSection={null} />,
};
