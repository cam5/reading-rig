import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";
import { DisplayText } from "./DisplayText";

// Button's own className is what pulls in Baloo 2 (`.btn` -> var(--font-heading),
// see bop.css), and that display face is scoped to exactly DISPLAY_STRINGS
// (#85) — so every label here has to be real DisplayText, not placeholder
// copy, to stay inside that closed set.
const meta = {
  title: "Components/Button",
  component: Button,
  args: { children: <DisplayText text="Save" /> },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

// The design's primary action colour — `--color-accent` — is invariant 1's
// "the machine's voice and the live thing". "Save" is the real
// primary-styled string (NoteComposer's submit button).
export const Primary: Story = { args: { variant: "primary" } };

// "Write a note" is the real secondary-styled string (SelectionToolbar's
// second button).
export const Secondary: Story = {
  args: { variant: "secondary", children: <DisplayText text="Write a note" /> },
};

// "Cancel" is the real ghost-styled string (NoteComposer/MarginaliaSidebar).
export const Ghost: Story = {
  args: { variant: "ghost", children: <DisplayText text="Cancel" /> },
};

export const Icon: Story = {
  args: { variant: "primary", icon: true, children: <DisplayText text="→" /> },
};

export const Disabled: Story = { args: { variant: "primary", disabled: true } };

// All four together, the way components/buttons.html shows them — the same
// three real strings/variants as the individual stories above.
export const AllVariants: Story = {
  render: (args) => (
    <div style={{ display: "flex", gap: 8 }}>
      <Button {...args} variant="primary">
        <DisplayText text="Save" />
      </Button>
      <Button {...args} variant="secondary">
        <DisplayText text="Write a note" />
      </Button>
      <Button {...args} variant="ghost">
        <DisplayText text="Cancel" />
      </Button>
    </div>
  ),
};
