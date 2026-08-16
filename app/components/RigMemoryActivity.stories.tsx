import type { Meta, StoryObj } from "@storybook/react-vite";
import { RigMemoryActivity } from "./RigMemoryActivity";

const meta = {
  title: "Components/Rig/RigMemoryActivity",
  component: RigMemoryActivity,
  args: {
    action: "read",
    path: "/mnt/memory/reader-preferences/cameron.md",
    status: "success",
  },
} satisfies Meta<typeof RigMemoryActivity>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Recalled: Story = {
  args: {
    action: "read",
    path: "/mnt/memory/reader-preferences/cameron.md",
    status: "success",
    preview: "Prefers close-reading over historical context unless asked.",
  },
};

export const Remembered: Story = {
  args: {
    action: "write",
    path: "/mnt/memory/reader-preferences/cameron.md",
    status: "success",
    preview: "Reading Capital slowly, one section per session.",
  },
};

export const Pending: Story = {
  args: {
    action: "read",
    path: "/mnt/memory/reader-preferences/cameron.md",
    status: "pending",
  },
};
