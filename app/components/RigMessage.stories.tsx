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

// A user turn carrying a ⟦context⟧ header (from opening the Rig) and an
// inline ⟦pill⟧ mention (from "@"-searching a paragraph) — both should
// collapse to a pill rather than showing their raw tags.
export const UserTurnWithPills: Story = {
  args: {
    role: "user",
    text:
      '⟦context⟧Reading "Capital, Vol. I" by Karl Marx. Currently on screen:\n\n' +
      "A commodity appears, at first sight, a very trivial thing, and easily understood.⟦/context⟧\n\n" +
      'What does ⟦pill kind="paragraph" locator="§4 ¶3"⟧A commodity appears as, first of all, an external ' +
      'object⟦/pill⟧ mean in Marx\'s own terms?',
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

// A buffered reply over the 100-word reveal threshold, with no live deltas
// behind it — confirmed live against staging-qa as the common case (deltas
// are "best-effort" per Anthropic's own docs, and landed far closer to
// "never" than "usually" here). Watch this story play: RigMessage should
// reveal the text word by word rather than flashing the whole paragraph in.
export const SimulatedReveal: Story = {
  args: {
    role: "agent",
    simulateReveal: true,
    text:
      "Pride and Prejudice appeared on 28 January 1813, published by Thomas Egerton of the Military Library, " +
      "Whitehall, in three volumes at eighteen shillings, bound. Austen sold the copyright outright for one " +
      "hundred and ten pounds rather than publish on commission as she had with Sense and Sensibility, a choice " +
      "she came to regret once the novel's popularity became clear. It appeared anonymously, credited only to " +
      "\"the author of Sense and Sensibility,\" the convention for a woman writing fiction at the time — Austen's " +
      "name never appeared on a title page in her lifetime. The novel as a form was still finding its footing in " +
      "1813, caught between the sprawling epistolary sentimentality of Richardson's generation and the gothic " +
      "excesses fashionable a decade earlier; Austen's close, ironic attention to a few families in a country " +
      "neighborhood was, by contrast, a deliberately narrow canvas. Early reception was warm rather than rapturous " +
      "— reviewers praised its wit and probability of incident, and the first edition sold out within months, " +
      "prompting a second printing that same year.",
  },
};

// Below the reveal threshold, simulateReveal has no visible effect — short
// replies render instantly rather than paying an animation tax.
export const SimulatedRevealBelowThreshold: Story = {
  args: {
    role: "agent",
    simulateReveal: true,
    text: "Chapter one opens at Longbourn, the Bennet family's estate.",
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
