import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";
import { ReaderHeader } from "./ReaderHeader";

const meta = {
  title: "Components/ReaderHeader",
  component: ReaderHeader,
  // Renders react-router Links — needs a router context even outside the app shell.
  decorators: [(Story) => <MemoryRouter><Story /></MemoryRouter>],
  args: {
    workId: "karl-marx/capital-volume-i",
    workTitle: "Capital, Volume I",
    progressPercent: 42,
    timeLeft: "3h 20m left",
    onPreviousSection: () => {},
    onNextSection: () => {},
    onOpenMargin: () => {},
  },
} satisfies Meta<typeof ReaderHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const JustStarted: Story = {
  args: { progressPercent: 0, timeLeft: "11h 45m left" },
};
