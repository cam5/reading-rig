import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  qaTurnEvents,
  toolUseTurnEvents,
} from "~/rig/__fixtures__/referenceSessionEvents";
import { toTranscriptItems } from "~/rig/toTranscriptItems";
import { RigComposer } from "./RigComposer";
import { RigPanel } from "./RigPanel";
import { RigTranscript } from "./RigTranscript";

const meta = {
  title: "Components/Rig/RigPanel",
  component: RigPanel,
  args: { open: true, onClose: () => {}, title: "Capital, Volume I", children: null },
  // The panel is `fixed`, positioned relative to the viewport rather than
  // Storybook's own canvas frame — give it room to actually show.
  decorators: [(Story) => <div style={{ position: "relative", height: "640px" }}><Story /></div>],
} satisfies Meta<typeof RigPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  render: (args) => (
    <RigPanel {...args}>
      <RigTranscript items={toTranscriptItems(toolUseTurnEvents)} />
      <div className="mt-auto pt-3">
        <RigComposer value="" onChange={() => {}} onSend={() => {}} />
      </div>
    </RigPanel>
  ),
};

export const Closed: Story = {
  args: { open: false },
  render: (args) => (
    <RigPanel {...args}>
      <RigTranscript items={toTranscriptItems(qaTurnEvents)} />
    </RigPanel>
  ),
};

export const Empty: Story = {
  render: (args) => (
    <RigPanel {...args}>
      <p className="text-[13px] opacity-50">Nothing said yet — write a line below.</p>
      <div className="mt-auto pt-3">
        <RigComposer value="" onChange={() => {}} onSend={() => {}} />
      </div>
    </RigPanel>
  ),
};
