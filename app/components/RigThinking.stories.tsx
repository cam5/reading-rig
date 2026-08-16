import type { Meta, StoryObj } from "@storybook/react-vite";
import { RigThinking } from "./RigThinking";

const meta = {
  title: "Components/Rig/RigThinking",
  component: RigThinking,
} satisfies Meta<typeof RigThinking>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomLabel: Story = {
  args: { label: "Searching the web…" },
};

/** Under a second — collapses to "a moment" rather than a misleading "0s". */
export const ResolvedMoment: Story = {
  args: { durationMs: 400 },
};

/** The common case: a several-second beat, e.g. the fixture's first
 * `agent.thinking` beat in `toolUseTurnEvents`. */
export const ResolvedSeconds: Story = {
  args: { durationMs: 4000 },
};

/** Past a minute — the fixture's longest beat is only ~11s, but a slower
 * turn can run past a minute and should read "Nm Ss", not a huge second
 * count. */
export const ResolvedMinutes: Story = {
  args: { durationMs: 72000 },
};
