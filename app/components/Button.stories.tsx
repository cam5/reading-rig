import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";

const meta = {
  title: "Components/Button",
  component: Button,
  args: { children: "Save to margin" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

// The design's primary action colour — terracotta, `--color-accent` — is
// invariant 1's "the machine's voice and the live thing". This is the
// button screen 1c's "Save to margin" and 2a's send arrow both use.
export const Primary: Story = { args: { variant: "primary" } };

export const Secondary: Story = { args: { variant: "secondary" } };

export const Ghost: Story = { args: { variant: "ghost" } };

export const Icon: Story = {
  args: { variant: "primary", icon: true, children: "→" },
};

export const Disabled: Story = { args: { variant: "primary", disabled: true } };

// All four together, the way components/buttons.html shows them.
export const AllVariants: Story = {
  render: (args) => (
    <div style={{ display: "flex", gap: 8 }}>
      <Button {...args} variant="primary">
        Primary
      </Button>
      <Button {...args} variant="secondary">
        Secondary
      </Button>
      <Button {...args} variant="ghost">
        Ghost
      </Button>
    </div>
  ),
};
