import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tag } from "./Tag";

const meta = {
  title: "Components/Tag",
  component: Tag,
  args: { children: "kept from the Rig" },
} satisfies Meta<typeof Tag>;

export default meta;
type Story = StoryObj<typeof meta>;

// Invariant 1: terracotta is the machine's voice and the live thing.
// Screen 3a's "kept from the Rig" tag, screen 1a's "Interrogate" tag.
export const Accent: Story = { args: { variant: "accent" } };

// Invariant 1: sage is your hand and your shelf.
// Screen 3a's "your hand" tag, screen 1a's context chips.
export const AccentTwo: Story = {
  args: { variant: "accent-2", children: "your hand" },
};

export const Neutral: Story = {
  args: { variant: "neutral", children: "Steelman" },
};

export const Outline: Story = { args: { variant: "outline", children: "+ add" } };

// Both roles side by side — the pairing invariant 1 depends on staying
// visually distinct at a glance.
export const BothRoles: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 8 }}>
      <Tag variant="accent">kept from the Rig · 46</Tag>
      <Tag variant="accent-2">your hand · 96</Tag>
    </div>
  ),
};
