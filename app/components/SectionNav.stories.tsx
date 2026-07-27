import type { Meta, StoryObj } from "@storybook/react-vite";
import { SectionNav } from "./SectionNav";

const meta = {
  title: "Components/SectionNav",
  component: SectionNav,
  args: {
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
  },
} satisfies Meta<typeof SectionNav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MidWork: Story = {};

export const AtStart: Story = {
  render: (args) => <SectionNav {...args} onPrevious={null} />,
};

export const AtEnd: Story = {
  render: (args) => <SectionNav {...args} onNext={null} />,
};
