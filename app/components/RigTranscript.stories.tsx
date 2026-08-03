import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  customToolTurnEvents,
  memoryTurnEvents,
  qaTurnEvents,
  toolUseTurnEvents,
} from "~/rig/__fixtures__/referenceSessionEvents";
import { toTranscriptItems } from "~/rig/toTranscriptItems";
import { RigTranscript } from "./RigTranscript";

const meta = {
  title: "Components/Rig/RigTranscript",
  component: RigTranscript,
  args: { items: [] },
} satisfies Meta<typeof RigTranscript>;

export default meta;
type Story = StoryObj<typeof meta>;

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="w-[520px] rounded-2xl bg-bg p-4">{children}</div>;
}

// The real, unedited session history for a turn with no tool calls.
export const PlainTurn: Story = {
  render: () => (
    <Panel>
      <RigTranscript items={toTranscriptItems(qaTurnEvents)} />
    </Panel>
  ),
};

// The real session history for a turn that reaches for the web: thinking,
// a web_search tool call, its result, a second thinking beat, the answer.
export const ToolUseTurn: Story = {
  render: () => (
    <Panel>
      <RigTranscript items={toTranscriptItems(toolUseTurnEvents)} />
    </Panel>
  ),
};

// Illustrative: a custom reading-tool call and a memory recall, composed
// into one transcript alongside a real turn — the shape a page combining
// both kinds of activity would end up rendering.
export const MixedTurn: Story = {
  render: () => (
    <Panel>
      <RigTranscript items={toTranscriptItems([...memoryTurnEvents, ...customToolTurnEvents, ...qaTurnEvents])} />
    </Panel>
  ),
};
