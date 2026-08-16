import type { Meta, StoryObj } from "@storybook/react-vite";
import { RigStatus } from "./RigStatus";

const meta = {
  title: "Components/Rig/RigStatus",
  component: RigStatus,
  args: { status: "running" },
} satisfies Meta<typeof RigStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

// Cycles through a shuffled RUNNING_VERBS every 2.2s while mounted, in a
// fresh order each mount — no single frame is a meaningful pixel-diff
// target, so Chromatic snapshotting is disabled here rather than pinned to
// whichever verb happens to land first.
export const Running: Story = {
  parameters: { chromatic: { disableSnapshot: true } },
};

export const Terminated: Story = {
  args: { status: "terminated" },
};

// session.error's error.message, e.g. BetaManagedAgentsModelOverloadedError.
export const Error: Story = {
  args: { status: "error", message: "The model is currently overloaded." },
};
