import type { Meta, StoryObj } from "@storybook/react-vite";
import { RigThinking } from "./RigThinking";

const meta = {
  title: "Components/Rig/RigThinking",
  component: RigThinking,
} satisfies Meta<typeof RigThinking>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomLabel: Story = {
  args: { label: "Searching the web…" },
};
