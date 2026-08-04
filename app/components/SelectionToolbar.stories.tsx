import type { Meta, StoryObj } from "@storybook/react-vite";
import { SelectionToolbar } from "./SelectionToolbar";

const meta = {
  title: "Components/SelectionToolbar",
  component: SelectionToolbar,
  args: {
    rect: new DOMRect(120, 160, 200, 20),
    onHighlight: () => {},
    onStartNote: () => {},
    onAskRig: () => {},
  },
} satisfies Meta<typeof SelectionToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
