import type { Meta, StoryObj } from "@storybook/react-vite";
import { RigAnchorMarker } from "./RigAnchorMarker";

const meta = {
  title: "Components/Rig/RigAnchorMarker",
  component: RigAnchorMarker,
  args: {
    onSelect: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ position: "relative", width: 200, height: 80 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RigAnchorMarker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleSession: Story = {
  args: { sessions: [{ id: "sess_1" }] },
};

// "1..n speech bubbles, stacked" — two RigSessions both pegged to the
// same paragraph.
export const StackedSessions: Story = {
  args: { sessions: [{ id: "sess_1" }, { id: "sess_2" }, { id: "sess_3" }] },
};
