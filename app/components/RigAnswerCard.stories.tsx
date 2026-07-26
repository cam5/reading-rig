import type { Meta, StoryObj } from "@storybook/react-vite";
import { RigAnswerCard } from "./RigAnswerCard";

const meta = {
  title: "Components/RigAnswerCard",
  component: RigAnswerCard,
  args: {
    posture: "Interrogate",
    body: "If the wood is unchanged and the labour is ordinary, the mystery must be in the relation, not the thing.",
    onSaveToMargin: () => {},
    onDiscard: () => {},
  },
} satisfies Meta<typeof RigAnswerCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Saving: Story = {
  args: { saving: true },
};

// Sitting where #29 places it — above "Today's page", on the same
// bg-surface panel, so the pending-vs-kept contrast (elevated shadow vs
// EntryCard's flat card) actually shows.
export const AbovePage: Story = {
  render: (args) => (
    <div className="flex w-[380px] flex-col gap-3 rounded-2xl bg-surface p-4">
      <RigAnswerCard {...args} />
    </div>
  ),
};
