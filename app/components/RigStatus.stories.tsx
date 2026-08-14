import type { Meta, StoryObj } from "@storybook/react-vite";
import { RigStatus } from "./RigStatus";

const meta = {
  title: "Components/Rig/RigStatus",
  component: RigStatus,
  args: { status: "running" },
} satisfies Meta<typeof RigStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

// Cycles through RUNNING_VERBS every 2.2s while mounted — a static
// screenshot only ever catches the first ("Thinking…").
export const Running: Story = {};

export const Terminated: Story = {
  args: { status: "terminated" },
};

// session.error's error.message, e.g. BetaManagedAgentsModelOverloadedError.
export const Error: Story = {
  args: { status: "error", message: "The model is currently overloaded." },
};
