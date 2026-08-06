import type { Meta, StoryObj } from "@storybook/react-vite";
import { createMemoryRouter, RouterProvider } from "react-router";
import {
  qaTurnEvents,
  toolUseTurnEvents,
} from "~/rig/__fixtures__/referenceSessionEvents";
import { toTranscriptItems } from "~/rig/toTranscriptItems";
import { RigPanel } from "./RigPanel";
import { RigTranscript } from "./RigTranscript";
import { TokenComposer } from "./TokenComposer";

const meta = {
  title: "Components/Rig/RigPanel",
  component: RigPanel,
  args: { open: true, onClose: () => {}, title: "Capital, Volume I", children: null },
  decorators: [
    // The panel is `fixed`, positioned relative to the viewport rather than
    // Storybook's own canvas frame — give it room to actually show.
    (Story) => <div style={{ position: "relative", height: "640px" }}><Story /></div>,
    // TokenComposer's mention hook is a useFetcher underneath, which needs a
    // data router — see MarginaliaSidebar's stories for the same wrapper.
    (Story) => <RouterProvider router={createMemoryRouter([{ path: "/", element: <Story /> }])} />,
  ],
} satisfies Meta<typeof RigPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  render: (args) => (
    <RigPanel {...args}>
      <RigTranscript items={toTranscriptItems(toolUseTurnEvents)} />
      <div className="mt-auto pt-3">
        <TokenComposer workId="story-work" onSend={() => {}} />
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
        <TokenComposer workId="story-work" onSend={() => {}} />
      </div>
    </RigPanel>
  ),
};
