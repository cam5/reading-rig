import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageStack } from "./PageStack";

const meta = {
  title: "Components/PageStack",
  component: PageStack,
  args: { progress: 0.37, side: "read" },
} satisfies Meta<typeof PageStack>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Read: Story = {
  args: { side: "read" },
  render: (args) => (
    <div style={{ height: 420 }}>
      <PageStack {...args} />
    </div>
  ),
};

export const ToGo: Story = {
  args: { side: "toGo" },
  render: (args) => (
    <div style={{ height: 420 }}>
      <PageStack {...args} />
    </div>
  ),
};

// The read.tsx layout: two stacks flanking the reading column, spines meeting
// at the text, thickness alone carrying the progress readout.
export const FlankingReadingColumn: Story = {
  render: (args) => (
    <div style={{ display: "flex", height: 420, gap: 0 }}>
      <PageStack {...args} side="read" />
      <div
        style={{
          flex: 1,
          background: "var(--color-bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          opacity: 0.5,
        }}
      >
        reading column
      </div>
      <PageStack {...args} side="toGo" />
    </div>
  ),
};

export const NearlyStarted: Story = {
  ...FlankingReadingColumn,
  args: { progress: 0.05 },
};

export const NearlyDone: Story = {
  ...FlankingReadingColumn,
  args: { progress: 0.92 },
};
