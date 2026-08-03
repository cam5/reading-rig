import type { Meta, StoryObj } from "@storybook/react-vite";
import { RigMessage } from "./RigMessage";

const meta = {
  title: "Components/Rig/RigMessage",
  component: RigMessage,
  args: { role: "agent", text: "Placeholder." },
} satisfies Meta<typeof RigMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

// Real agent.message text, from referenceSessionEvents.ts's toolUseTurnEvents.
export const AgentTurn: Story = {
  args: {
    role: "agent",
    text:
      'The line opens Section 4 of Chapter 1, "The Fetishism of Commodities and the Secret Thereof" — the hinge ' +
      "where Marx pivots from the dry analytics of use-value and exchange-value into something stranger.",
  },
};

// Real user.message text, from the same fixture.
export const UserTurn: Story = {
  args: {
    role: "user",
    text:
      'Here is the passage: "A commodity appears, at first sight, a very trivial thing, and easily understood." ' +
      "Search the web for when Marx wrote this chapter and give me one sentence of historical context, citing where you found it.",
  },
};

// While an event_delta preview is still streaming content_delta fragments in.
export const Streaming: Story = {
  args: {
    role: "agent",
    text: "The line opens Section 4 of Chapter 1, \"The Fetishism of Commodities",
    streaming: true,
  },
};

export const Exchange: Story = {
  render: () => (
    <div className="flex w-[480px] flex-col divide-y divide-[var(--color-divider)]">
      <RigMessage role="user" text="What's happening in this passage?" />
      <RigMessage
        role="agent"
        text="You haven't shared the passage yet — only the question. Paste the lines you're looking at and I'll read them with you."
      />
    </div>
  ),
};
