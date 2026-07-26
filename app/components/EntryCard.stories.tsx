import type { Meta, StoryObj } from "@storybook/react-vite";
import { EntryCard } from "./EntryCard";

const meta = {
  title: "Components/EntryCard",
  component: EntryCard,
  args: { origin: "hand", body: "Placeholder body." },
} satisfies Meta<typeof EntryCard>;

export default meta;
type Story = StoryObj<typeof meta>;

// 1c's "Today's page", card 1 — a Rig entry, posture kicker in terracotta.
export const RigEntry: Story = {
  args: {
    origin: "rig",
    posture: "Interrogate",
    locator: "§4 ¶3",
    body: "If the wood is unchanged and the labour is ordinary, the mystery must be in the relation, not the thing.",
  },
};

// 1c's "Today's page", card 2 — a hand entry, "Your hand" kicker in sage.
export const HandEntry: Story = {
  args: {
    origin: "hand",
    locator: "§4 ¶2",
    excerpt: "The mystery isn't in the object",
    body: "Keep this for the Adorno chapter.",
  },
};

// 1c's "Today's page", card 3 — surfaced by association, dimmed.
export const DimmedConnectEntry: Story = {
  args: {
    origin: "rig",
    posture: "Connect",
    body: "Three passages you highlighted in The Order of Things turn on the same move.",
    dimmed: true,
  },
};

// 3a's commonplace book — the same card, with the work/chapter/locator
// folded into `locator` (there's more than one book in view here) and a
// trailing date, since accrual across the whole shelf is the point.
export const CommonplaceEntry: Story = {
  args: {
    origin: "hand",
    locator: "Capital, Volume I · Ch. 1 §4 ¶3",
    excerpt: "the table continues to be that common, every-day thing, wood",
    date: "12 Mar",
    body: "The mystery isn't in the object. Keep this for the Adorno chapter.",
  },
};

// All three together, the way 1c's right pane stacks them — on a
// bg-surface panel, same as the real right pane, since EntryCard's own
// bg-bg fill only reads against something else.
export const TodaysPage: Story = {
  render: () => (
    <div className="flex w-[380px] flex-col gap-3 rounded-2xl bg-surface p-4">
      <EntryCard
        origin="rig"
        posture="Interrogate"
        locator="§4 ¶3"
        body="If the wood is unchanged and the labour is ordinary, the mystery must be in the relation, not the thing."
      />
      <EntryCard
        origin="hand"
        locator="§4 ¶2"
        excerpt="The mystery isn't in the object"
        body="Keep this for the Adorno chapter."
      />
      <EntryCard
        origin="rig"
        posture="Connect"
        body="Three passages you highlighted in The Order of Things turn on the same move."
        dimmed
      />
    </div>
  ),
};
